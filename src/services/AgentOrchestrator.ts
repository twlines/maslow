/**
 * Agent Orchestrator Service
 *
 * Manages spawning, monitoring, and coordinating autonomous agents against
 * kanban cards. Each agent works in an isolated git worktree on a feature
 * branch and must pass Gate 1 verification (tsc + lint + tests) before
 * the branch is pushed.
 *
 * Uses Ollama (local LLM) for autonomous execution. Claude is reserved
 * for interactive thinking partner conversations.
 */

import { Context, Effect, Layer, Fiber } from "effect"
import { execSync } from "child_process"
import { ConfigService } from "./Config.js"
import { Kanban } from "./Kanban.js"
import { AppPersistence } from "./AppPersistence.js"
import type { AgentType, AgentStatus } from "@maslow/shared"
import { Telegram } from "./Telegram.js"
import { OllamaAgent } from "./OllamaAgent.js"
import { runVerification } from "./protocols/VerificationProtocol.js"

export interface AgentProcess {
  cardId: string
  projectId: string
  agent: AgentType
  process: null
  fiber: Fiber.RuntimeFiber<void, Error> | null
  status: AgentStatus
  startedAt: number
  logs: string[]
  branchName: string
}

export interface AgentLogEvent {
  cardId: string
  line: string
  timestamp: number
}

export interface AgentOrchestratorService {
  spawnAgent(options: {
    cardId: string
    projectId: string
    agent: AgentType
    prompt: string
    cwd: string
  }): Effect.Effect<AgentProcess, Error>

  stopAgent(cardId: string): Effect.Effect<void, Error>

  getRunningAgents(): Effect.Effect<AgentProcess[]>

  getAgentLogs(cardId: string, limit?: number): Effect.Effect<string[]>

  /** Gracefully shut down all running agents */
  shutdownAll(): Effect.Effect<void>
}

export class AgentOrchestrator extends Context.Tag("AgentOrchestrator")<
  AgentOrchestrator,
  AgentOrchestratorService
>() {}

// Broadcast function type — set by AppServer when WebSocket is available
type BroadcastFn = (message: Record<string, unknown>) => void
let broadcast: BroadcastFn = () => {}

export function setAgentBroadcast(fn: BroadcastFn) {
  broadcast = fn
}

export const AgentOrchestratorLive = Layer.effect(
  AgentOrchestrator,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const kanban = yield* Kanban
    const db = yield* AppPersistence
    const telegram = yield* Telegram
    const ollamaAgent = yield* OllamaAgent

    const chatId = config.telegram.userId
    const MAX_CONCURRENT = 3
    const MAX_LOG_LINES = 500
    const AGENT_TIMEOUT_MS = 30 * 60 * 1000
    const agents = new Map<string, AgentProcess>()

    const slugify = (text: string): string =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)

    return {
      spawnAgent: (options) =>
        Effect.gen(function* () {
          // Check concurrency limit
          const running = [...agents.values()].filter((a) => a.status === "running")
          if (running.length >= MAX_CONCURRENT) {
            return yield* Effect.fail(new Error(`Max concurrent agents reached (${MAX_CONCURRENT}). Wait for one to finish.`))
          }

          // Check per-project limit
          const projectAgents = running.filter((a) => a.projectId === options.projectId)
          if (projectAgents.length > 0) {
            return yield* Effect.fail(new Error(`Project ${options.projectId} already has a running agent. One agent per project.`))
          }

          // Check agent already assigned to this card
          if (agents.has(options.cardId)) {
            const existing = agents.get(options.cardId)!
            if (existing.status === "running") {
              return yield* Effect.fail(new Error(`Card ${options.cardId} already has a running agent.`))
            }
          }

          // Get card details for context
          const card = yield* db.getCard(options.cardId)
          if (!card) {
            return yield* Effect.fail(new Error(`Card ${options.cardId} not found.`))
          }

          // Get project config for per-project timeout
          const project = yield* db.getProject(options.projectId)
          const agentTimeoutMs = project?.agentTimeoutMinutes
            ? project.agentTimeoutMinutes * 60 * 1000
            : AGENT_TIMEOUT_MS

          const branchName = `agent/${options.agent}/${slugify(card.title)}-${options.cardId.slice(0, 8)}`

          // Create isolated worktree so agents don't clobber the server's working tree
          const worktreeDir = `${options.cwd}/.worktrees/${options.cardId.slice(0, 8)}`
          try {
            execSync(`git worktree add -b ${branchName} ${worktreeDir}`, { cwd: options.cwd, stdio: "pipe" })
          } catch {
            // Branch might already exist — try attaching worktree to existing branch
            try {
              execSync(`git worktree add ${worktreeDir} ${branchName}`, { cwd: options.cwd, stdio: "pipe" })
            } catch (err) {
              return yield* Effect.fail(new Error(`Failed to create worktree for ${branchName}: ${err}`))
            }
          }

          // Symlink node_modules so verification commands work in worktree
          try {
            execSync(`ln -sf ${options.cwd}/node_modules ${worktreeDir}/node_modules`, { stdio: "pipe" })
          } catch { /* best effort */ }

          // Mark card as in progress
          yield* kanban.startWork(options.cardId, options.agent)

          const agentProcess: AgentProcess = {
            cardId: options.cardId,
            projectId: options.projectId,
            agent: options.agent,
            process: null,
            fiber: null,
            status: "running",
            startedAt: Date.now(),
            logs: [],
            branchName,
          }

          const addLog = (line: string) => {
            agentProcess.logs.push(line)
            if (agentProcess.logs.length > MAX_LOG_LINES) {
              agentProcess.logs.shift()
            }
            broadcast({ type: "agent.log", cardId: options.cardId, projectId: options.projectId, line })
          }

          // Clean up worktree helper
          const cleanupWorktree = () => {
            try {
              execSync(`git worktree remove ${worktreeDir} --force`, { cwd: options.cwd, stdio: "pipe" })
            } catch {
              // Best effort — worktree may already be gone
            }
          }

          // Helper to send failure notification
          const notifyFailure = (reason: string) => {
            const msg = `Agent failed on "${card.title}"\n\nReason: ${reason}`
            Effect.runPromise(
              telegram.sendMessage(chatId, msg).pipe(Effect.ignore)
            ).catch(() => {})
          }

          // The Ollama agent task — runs as a fiber
          const agentTask = Effect.gen(function* () {
            // Execute the Ollama agent loop
            const result = yield* ollamaAgent.executeTask({
              worktreeDir,
              card: { id: card.id, title: card.title, description: card.description },
              projectId: options.projectId,
              onLog: addLog,
            })

            if (result.success) {
              // Ollama loop passed its own internal verification — run Gate 1
              agentProcess.status = "completed"
              addLog("[orchestrator] Ollama agent completed, running Gate 1 verification...")
              broadcast({ type: "verification.started", cardId: options.cardId, gate: "branch" })

              const verification = runVerification(worktreeDir)

              if (verification.passed) {
                addLog("[orchestrator] Gate 1 PASSED — branch verified")
                broadcast({ type: "verification.passed", cardId: options.cardId, gate: "branch" })
                broadcast({ type: "agent.completed", cardId: options.cardId, projectId: options.projectId })

                yield* db.updateCardVerification(options.cardId, "branch_verified")
                yield* kanban.updateAgentStatus(options.cardId, "completed")
                yield* kanban.saveContext(options.cardId, `Gate 1 passed. Branch: ${branchName}`)
                yield* db.logAudit("agent", options.cardId, "verification.branch_passed", {
                  cardId: options.cardId,
                  agent: options.agent,
                  branchName,
                })
                yield* telegram.sendMessage(
                  chatId,
                  `Gate 1 PASSED: "${card.title}" (branch: ${branchName}). Awaiting Gate 2.`
                ).pipe(Effect.ignore)

                // Push branch
                try {
                  execSync(`git push -u origin ${branchName}`, { cwd: worktreeDir, stdio: "pipe" })
                  addLog(`[orchestrator] Branch ${branchName} pushed to origin`)
                } catch (err) {
                  addLog(`[orchestrator] Push failed: ${err}. Work saved on local branch.`)
                }
              } else {
                // Gate 1 FAILED
                const failureOutput = [
                  verification.tscOutput ? `TSC:\n${verification.tscOutput}` : "",
                  verification.lintOutput ? `LINT:\n${verification.lintOutput}` : "",
                  verification.testOutput ? `TEST:\n${verification.testOutput}` : "",
                ].filter(Boolean).join("\n\n").slice(0, 5000)

                addLog("[orchestrator] Gate 1 FAILED — branch verification failed")
                broadcast({
                  type: "verification.failed",
                  cardId: options.cardId,
                  gate: "branch",
                  output: failureOutput.slice(0, 500),
                })
                broadcast({ type: "agent.failed", cardId: options.cardId, projectId: options.projectId, error: "Gate 1 verification failed" })

                yield* db.updateCardVerification(options.cardId, "branch_failed", failureOutput)
                yield* kanban.updateAgentStatus(options.cardId, "blocked", `Gate 1 failed: ${failureOutput.slice(0, 200)}`)
                yield* db.logAudit("agent", options.cardId, "verification.branch_failed", {
                  cardId: options.cardId,
                  agent: options.agent,
                  branchName,
                })
                yield* telegram.sendMessage(
                  chatId,
                  `Gate 1 FAILED: "${card.title}"\n\n${failureOutput.slice(0, 500)}`
                ).pipe(Effect.ignore)
              }
            } else {
              // Ollama agent itself failed (all retries exhausted, no files found, etc.)
              agentProcess.status = "failed"
              const reason = "Ollama agent failed after retries"
              addLog(`[orchestrator] ${reason}`)
              broadcast({ type: "agent.failed", cardId: options.cardId, projectId: options.projectId, error: reason })
              notifyFailure(reason)

              yield* kanban.updateAgentStatus(options.cardId, "blocked", reason)
              yield* db.logAudit("agent", options.cardId, "agent.failed", {
                cardId: options.cardId,
                agent: options.agent,
                reason,
              })
            }

            // Track token usage
            yield* db.insertTokenUsage({
              cardId: options.cardId,
              projectId: options.projectId,
              agent: options.agent,
              inputTokens: result.totalInputTokens,
              outputTokens: result.totalOutputTokens,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
              createdAt: Date.now(),
            }).pipe(Effect.ignore)

            cleanupWorktree()
          }).pipe(
            Effect.catchAll((err) =>
              Effect.gen(function* () {
                agentProcess.status = "failed"
                const reason = err instanceof Error ? err.message : String(err)
                addLog(`[orchestrator] Agent error: ${reason}`)
                broadcast({ type: "agent.failed", cardId: options.cardId, projectId: options.projectId, error: reason })
                notifyFailure(reason)

                yield* kanban.updateAgentStatus(options.cardId, "failed", reason)
                yield* db.logAudit("agent", options.cardId, "agent.failed", {
                  cardId: options.cardId,
                  agent: options.agent,
                  reason,
                })
                cleanupWorktree()
              })
            ),
            Effect.timeout(agentTimeoutMs),
            Effect.catchTag("TimeoutException", () =>
              Effect.gen(function* () {
                agentProcess.status = "failed"
                const reason = `Timed out after ${agentTimeoutMs / 60000} minutes`
                addLog(`[orchestrator] ${reason}`)
                broadcast({ type: "agent.timeout", cardId: options.cardId })

                yield* kanban.updateAgentStatus(options.cardId, "failed", "Agent timed out")
                yield* db.logAudit("agent", options.cardId, "agent.timeout", {
                  cardId: options.cardId,
                  agent: options.agent,
                  timeoutMs: agentTimeoutMs,
                })
                cleanupWorktree()
              })
            )
          )

          // Fork the agent task as a fiber
          const fiber = yield* Effect.fork(agentTask)
          agentProcess.fiber = fiber

          agents.set(options.cardId, agentProcess)
          broadcast({ type: "agent.spawned", cardId: options.cardId, projectId: options.projectId, agent: options.agent })

          yield* db.logAudit("agent", options.cardId, "agent.spawned", {
            cardId: options.cardId,
            agent: options.agent,
            branchName,
          })
          yield* Effect.log(`Agent ${options.agent} spawned on card ${options.cardId} (branch: ${branchName})`)

          return agentProcess
        }),

      stopAgent: (cardId) =>
        Effect.gen(function* () {
          const agent = agents.get(cardId)
          if (!agent) {
            return yield* Effect.fail(new Error(`No agent found for card ${cardId}`))
          }

          if (agent.fiber && agent.status === "running") {
            // Save context before interrupting
            const contextSnapshot = `Agent ${agent.agent} stopped by user. Last ${Math.min(agent.logs.length, 20)} log lines:\n${agent.logs.slice(-20).join("\n")}`
            yield* kanban.saveContext(cardId, contextSnapshot)
            yield* kanban.updateAgentStatus(cardId, "idle")

            yield* Fiber.interrupt(agent.fiber)
            agent.status = "idle"
            agent.logs.push("[orchestrator] Agent stopped by user")
          }
        }),

      getRunningAgents: () =>
        Effect.sync(() => {
          return [...agents.values()].map((a) => ({
            ...a,
            process: null,
            fiber: null,
          }))
        }),

      getAgentLogs: (cardId, limit = 100) =>
        Effect.sync(() => {
          const agent = agents.get(cardId)
          if (!agent) return []
          return agent.logs.slice(-limit)
        }),

      shutdownAll: () =>
        Effect.gen(function* () {
          const running = [...agents.values()].filter(a => a.status === "running" && a.fiber)
          if (running.length === 0) return

          yield* Effect.log(`Graceful shutdown: stopping ${running.length} running agent(s)...`)

          for (const agent of running) {
            if (agent.fiber) {
              yield* Fiber.interrupt(agent.fiber).pipe(Effect.ignore)
            }
            agent.logs.push("[orchestrator] Interrupted (server shutting down)")

            // Save context so work isn't lost
            yield* kanban.saveContext(
              agent.cardId,
              `Agent stopped by server shutdown. Branch: ${agent.branchName}\nLast log lines:\n${agent.logs.slice(-10).join("\n")}`
            ).pipe(Effect.ignore)
          }

          yield* Effect.log("All agents stopped.")
        }),
    }
  })
)
