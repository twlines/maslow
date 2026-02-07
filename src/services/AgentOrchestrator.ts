/**
 * Agent Orchestrator Service
 *
 * Manages spawning, monitoring, and coordinating CLI-based coding agents
 * (Claude Code, Codex, Gemini CLI) against kanban cards. Each agent gets
 * assigned to a card, works on a feature branch, and opens a PR with a
 * verification-prompt.md when done.
 */

import { Context, Effect, Layer, Stream } from "effect"
import { spawn, execSync, type ChildProcess } from "child_process"
import { ConfigService } from "./Config.js"
import { Kanban } from "./Kanban.js"
import { AppPersistence, type AgentType, type AgentStatus } from "./AppPersistence.js"

export interface AgentProcess {
  cardId: string
  projectId: string
  agent: AgentType
  process: ChildProcess | null
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

    const MAX_CONCURRENT = 3
    const MAX_LOG_LINES = 500
    const agents = new Map<string, AgentProcess>()

    const slugify = (text: string): string =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)

    const buildAgentCommand = (agent: AgentType, prompt: string, cwd: string): { cmd: string; args: string[] } => {
      switch (agent) {
        case "claude":
          return {
            cmd: "claude",
            args: [
              "-p",
              "--output-format", "stream-json",
              "--permission-mode", "bypassPermissions",
              "--max-turns", "50",
              "--cwd", cwd,
              prompt,
            ],
          }
        case "codex":
          return {
            cmd: "codex",
            args: ["--approval-mode", "full-auto", "-q", prompt],
          }
        case "gemini":
          return {
            cmd: "gemini",
            args: ["-y", prompt],
          }
      }
    }

    const buildAgentPrompt = (card: { title: string; description: string; contextSnapshot: string | null }, userPrompt: string): string => {
      let prompt = `## Task\n\nYou are working on the following kanban card:\n\n**${card.title}**\n${card.description}\n\n`

      if (card.contextSnapshot) {
        prompt += `## Previous Context\n\nThis card was previously worked on. Here's where we left off:\n\n${card.contextSnapshot}\n\n`
      }

      prompt += `## Instructions\n\n${userPrompt}\n\n`

      prompt += `## When Done\n\n`
      prompt += `1. Ensure all changes compile and lint cleanly\n`
      prompt += `2. Create a verification-prompt.md in the repo root with:\n`
      prompt += `   - The card title and goals\n`
      prompt += `   - Acceptance criteria (checklist)\n`
      prompt += `   - Specific verification steps\n`
      prompt += `   - List of files changed\n`
      prompt += `3. Commit all changes with a descriptive message\n`
      prompt += `4. Do NOT push or create a PR — the orchestrator handles that\n`

      return prompt
    }

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

          const branchName = `agent/${options.agent}/${slugify(card.title)}-${options.cardId.slice(0, 8)}`
          const fullPrompt = buildAgentPrompt(card, options.prompt)
          const { cmd, args } = buildAgentCommand(options.agent, fullPrompt, options.cwd)

          // Create branch
          try {
            execSync(`git checkout -b ${branchName}`, { cwd: options.cwd, stdio: "pipe" })
          } catch {
            // Branch might already exist
            try {
              execSync(`git checkout ${branchName}`, { cwd: options.cwd, stdio: "pipe" })
            } catch (err) {
              return yield* Effect.fail(new Error(`Failed to create branch ${branchName}: ${err}`))
            }
          }

          // Mark card as in progress
          yield* kanban.startWork(options.cardId, options.agent)

          const agentProcess: AgentProcess = {
            cardId: options.cardId,
            projectId: options.projectId,
            agent: options.agent,
            process: null,
            status: "running",
            startedAt: Date.now(),
            logs: [],
            branchName,
          }

          // Spawn the agent process
          const env = { ...process.env }
          delete env.ANTHROPIC_API_KEY // Force OAuth for Claude

          const child = spawn(cmd, args, {
            cwd: options.cwd,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            env,
          })

          agentProcess.process = child

          const addLog = (line: string) => {
            agentProcess.logs.push(line)
            if (agentProcess.logs.length > MAX_LOG_LINES) {
              agentProcess.logs.shift()
            }
            broadcast({ type: "agent.log", cardId: options.cardId, line })
          }

          // Stream stdout
          let stdoutBuffer = ""
          child.stdout?.on("data", (chunk: Buffer) => {
            stdoutBuffer += chunk.toString()
            const lines = stdoutBuffer.split("\n")
            stdoutBuffer = lines.pop() || ""
            for (const line of lines) {
              if (line.trim()) addLog(line)
            }
          })

          // Stream stderr
          let stderrBuffer = ""
          child.stderr?.on("data", (chunk: Buffer) => {
            stderrBuffer += chunk.toString()
            const lines = stderrBuffer.split("\n")
            stderrBuffer = lines.pop() || ""
            for (const line of lines) {
              if (line.trim()) addLog(`[stderr] ${line}`)
            }
          })

          // Handle process exit
          child.on("close", (code) => {
            if (code === 0) {
              agentProcess.status = "completed"
              addLog(`[orchestrator] Agent completed successfully`)
              broadcast({ type: "agent.completed", cardId: options.cardId })

              // Save final context and open PR
              Effect.runPromise(
                Effect.gen(function* () {
                  yield* kanban.completeWork(options.cardId)
                  yield* kanban.saveContext(options.cardId, `Agent ${options.agent} completed. Branch: ${branchName}`)
                })
              ).then(() => {
                // Push branch and open PR (after Effect completes)
                try {
                  execSync(`git push -u origin ${branchName}`, { cwd: options.cwd, stdio: "pipe" })
                  const prTitle = card.title.slice(0, 70)
                  const prBody = `## Card\n${card.title}\n\n## Description\n${card.description}\n\n## Agent\n${options.agent}\n\nSee \`verification-prompt.md\` for verification criteria.`
                  execSync(`gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --head ${branchName}`, {
                    cwd: options.cwd,
                    stdio: "pipe",
                  })
                  addLog(`[orchestrator] PR created on branch ${branchName}`)
                } catch (err) {
                  addLog(`[orchestrator] Failed to create PR: ${err}`)
                }
              }).catch((err) => {
                addLog(`[orchestrator] Post-completion error: ${err}`)
              })
            } else {
              agentProcess.status = "failed"
              const reason = `Process exited with code ${code}`
              addLog(`[orchestrator] Agent failed: ${reason}`)
              broadcast({ type: "agent.failed", cardId: options.cardId, error: reason })

              Effect.runPromise(
                kanban.updateAgentStatus(options.cardId, "failed", reason)
              ).catch(console.error)
            }
          })

          child.on("error", (err) => {
            agentProcess.status = "failed"
            addLog(`[orchestrator] Spawn error: ${err.message}`)
            broadcast({ type: "agent.failed", cardId: options.cardId, error: err.message })

            Effect.runPromise(
              kanban.updateAgentStatus(options.cardId, "failed", err.message)
            ).catch(console.error)
          })

          agents.set(options.cardId, agentProcess)
          broadcast({ type: "agent.spawned", cardId: options.cardId, agent: options.agent })

          yield* Effect.log(`Agent ${options.agent} spawned on card ${options.cardId} (branch: ${branchName})`)

          return agentProcess
        }),

      stopAgent: (cardId) =>
        Effect.gen(function* () {
          const agent = agents.get(cardId)
          if (!agent) {
            return yield* Effect.fail(new Error(`No agent found for card ${cardId}`))
          }

          if (agent.process && agent.status === "running") {
            // Save context before killing
            const contextSnapshot = `Agent ${agent.agent} stopped by user. Last ${Math.min(agent.logs.length, 20)} log lines:\n${agent.logs.slice(-20).join("\n")}`
            yield* kanban.saveContext(cardId, contextSnapshot)
            yield* kanban.updateAgentStatus(cardId, "idle")

            // Graceful shutdown: SIGTERM, then SIGKILL after 5s
            agent.process.kill("SIGTERM")
            const killTimer = setTimeout(() => {
              if (agent.process && !agent.process.killed) {
                agent.process.kill("SIGKILL")
              }
            }, 5000)

            agent.process.on("close", () => {
              clearTimeout(killTimer)
            })

            agent.status = "idle"
            agent.logs.push("[orchestrator] Agent stopped by user")
          }
        }),

      getRunningAgents: () =>
        Effect.sync(() => {
          return [...agents.values()].map((a) => ({
            ...a,
            process: null, // Don't serialize the process object
          }))
        }),

      getAgentLogs: (cardId, limit = 100) =>
        Effect.sync(() => {
          const agent = agents.get(cardId)
          if (!agent) return []
          return agent.logs.slice(-limit)
        }),
    }
  })
)
