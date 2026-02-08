/**
 * Agent Orchestrator Service
 *
 * Manages spawning, monitoring, and coordinating CLI-based coding agents
 * (Claude Code, Codex, Gemini CLI) against kanban cards. Each agent gets
 * assigned to a card, works on a feature branch, and opens a PR with a
 * verification-prompt.md when done.
 *
 * Sub-modules:
 *   - prompt-builder.ts  — assembles the full agent prompt
 *   - process-manager.ts — spawns and manages child processes
 *   - worktree.ts        — git worktree create/remove helpers
 */

import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../Config.js"
import { Kanban } from "../Kanban.js"
import { AppPersistence } from "../AppPersistence.js"
import { SteeringEngine } from "../SteeringEngine.js"
import { Telegram } from "../Telegram.js"
import { buildAgentPrompt } from "./prompt-builder.js"
import { buildAgentCommand, spawnAgentProcess } from "./process-manager.js"
import { generateBranchName, worktreePath, createWorktree } from "./worktree.js"

export type { AgentProcess, AgentLogEvent, ProcessManagerDeps } from "./types.js"
import type { AgentProcess } from "./types.js"

export interface AgentOrchestratorService {
  spawnAgent(options: {
    cardId: string
    projectId: string
    agent: import("../AppPersistence.js").AgentType
    prompt: string
    cwd: string
  }): Effect.Effect<AgentProcess, Error>

  stopAgent(cardId: string): Effect.Effect<void, Error>

  getRunningAgents(): Effect.Effect<AgentProcess[]>

  getAgentLogs(cardId: string, limit?: number): Effect.Effect<string[]>

  /** Gracefully shut down all running agents (SIGTERM → wait → SIGKILL) */
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

const MAX_CONCURRENT = 3
const AGENT_TIMEOUT_MS = 30 * 60 * 1000

export const AgentOrchestratorLive = Layer.effect(
  AgentOrchestrator,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const kanban = yield* Kanban
    const db = yield* AppPersistence
    const steering = yield* SteeringEngine
    const telegram = yield* Telegram

    const chatId = config.telegram.userId
    const agents = new Map<string, AgentProcess>()

    return {
      spawnAgent: (options) =>
        Effect.gen(function* () {
          // --- Validation ---
          const running = [...agents.values()].filter((a) => a.status === "running")
          if (running.length >= MAX_CONCURRENT) {
            return yield* Effect.fail(new Error(`Max concurrent agents reached (${MAX_CONCURRENT}). Wait for one to finish.`))
          }
          const projectAgents = running.filter((a) => a.projectId === options.projectId)
          if (projectAgents.length > 0) {
            return yield* Effect.fail(new Error(`Project ${options.projectId} already has a running agent. One agent per project.`))
          }
          if (agents.has(options.cardId)) {
            const existing = agents.get(options.cardId)!
            if (existing.status === "running") {
              return yield* Effect.fail(new Error(`Card ${options.cardId} already has a running agent.`))
            }
          }

          // --- Fetch card & project ---
          const card = yield* db.getCard(options.cardId)
          if (!card) {
            return yield* Effect.fail(new Error(`Card ${options.cardId} not found.`))
          }
          const project = yield* db.getProject(options.projectId)
          const agentTimeoutMs = project?.agentTimeoutMinutes
            ? project.agentTimeoutMinutes * 60 * 1000
            : AGENT_TIMEOUT_MS

          // --- Build prompt & command ---
          const branchName = generateBranchName(options.agent, card.title, options.cardId)
          const fullPrompt = yield* buildAgentPrompt({ db, kanban, steering }, { ...card, projectId: options.projectId }, options.prompt)
          const { cmd, args } = buildAgentCommand(options.agent, fullPrompt)

          // --- Create worktree ---
          const wtDir = worktreePath(options.cwd, options.cardId)
          try {
            createWorktree(options.cwd, wtDir, branchName)
          } catch (err) {
            return yield* Effect.fail(new Error(`Failed to create worktree for ${branchName}: ${err}`))
          }

          // --- Mark card in progress ---
          yield* kanban.startWork(options.cardId, options.agent)

          // --- Initialize agent process record ---
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

          // --- Spawn process ---
          spawnAgentProcess({
            agentProcess,
            cmd,
            args,
            worktreeDir: wtDir,
            cwd: options.cwd,
            agentTimeoutMs,
            card: { title: card.title, description: card.description },
            deps: { kanban, db, telegram, chatId, broadcast },
          })

          // --- Register & broadcast ---
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

          if (agent.process && agent.status === "running") {
            const contextSnapshot = `Agent ${agent.agent} stopped by user. Last ${Math.min(agent.logs.length, 20)} log lines:\n${agent.logs.slice(-20).join("\n")}`
            yield* kanban.saveContext(cardId, contextSnapshot)
            yield* kanban.updateAgentStatus(cardId, "idle")

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
            process: null,
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
          const running = [...agents.values()].filter(
            a => a.status === "running" && a.process && !a.process.killed
          )
          if (running.length === 0) return

          yield* Effect.log(`Graceful shutdown: stopping ${running.length} running agent(s)...`)

          for (const agent of running) {
            agent.process!.kill("SIGTERM")
            agent.logs.push("[orchestrator] SIGTERM sent (server shutting down)")
          }

          yield* Effect.tryPromise({
            try: () => new Promise<void>((resolve) => {
              let remaining = running.length
              const timeout = setTimeout(() => resolve(), 30000)
              for (const agent of running) {
                agent.process!.on("close", () => {
                  remaining--
                  if (remaining <= 0) {
                    clearTimeout(timeout)
                    resolve()
                  }
                })
              }
            }),
            catch: () => new Error("Shutdown wait failed"),
          }).pipe(Effect.ignore)

          for (const agent of running) {
            if (agent.process && !agent.process.killed) {
              agent.process.kill("SIGKILL")
              agent.logs.push("[orchestrator] SIGKILL sent (shutdown timeout)")
            }
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
