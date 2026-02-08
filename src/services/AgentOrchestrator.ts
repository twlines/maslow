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
import { SteeringEngine } from "./SteeringEngine.js"
import { Telegram } from "./Telegram.js"

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

export const AgentOrchestratorLive = Layer.effect(
  AgentOrchestrator,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const kanban = yield* Kanban
    const db = yield* AppPersistence
    const steering = yield* SteeringEngine
    const telegram = yield* Telegram

    const chatId = config.telegram.userId
    const MAX_CONCURRENT = 3
    const MAX_LOG_LINES = 500
    const AGENT_TIMEOUT_MS = 30 * 60 * 1000 // 30-min timeout for zombie agents
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
              "--verbose",
              "--output-format", "stream-json",
              "--permission-mode", "bypassPermissions",
              "--max-turns", "50",
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

    const DEEP_RESEARCH_PROTOCOL = `## Deep Research Protocol (MANDATORY)

Before writing ANY code, you MUST complete all 3 research passes. Do not skip passes. Each pass has a specific adversarial lens.

### Pass 1: Forward Trace (Understand the Happy Path)
Lens: "What does this code do today?"
1. Trace the entry point — find the user action, API call, or trigger that starts the flow.
2. Follow every function call — read each file, note the exact line numbers.
3. Document the data shape at each boundary (function args, API request/response, DTOs).
4. Map the dependency chain — what packages, services, and external APIs are involved?
5. Identify the exit point — where does the result surface to the user?

Output a trace document with a Mermaid diagram showing the flow, every file involved, and the data transformations at each step.
Self-check: Can I draw the complete flow from trigger to user-visible result? Did I read every file, or did I assume? Are there parallel paths or branching logic I haven't followed?

### Pass 2: Inventory Audit (What exists but isn't connected?)
Lens: "What did I miss? What's built but not wired?"
1. Search for siblings — if you found FooDisk.ts, search find_by_name *Disk* in the same directory. List ALL of them.
2. Search for pipelines — find every pipeline definition, not just the one currently called.
3. Check reference documents — look for design briefs, architecture docs, READMEs in the relevant directories. Check the user's Downloads folder and open editor tabs for context docs.
4. Cross-reference — for every component in the trace, ask: "Is there a newer/better/more complete version that exists but isn't used?"
5. Check the card description — did you trace EVERYTHING the card asks about, or just a subset?

Output an inventory table: Component | Code Exists? | Wired In? | Status
Self-check: Did I search broadly (glob patterns, not just exact names)? Did I check reference docs? Does my inventory cover 100% of components in this domain?

### Pass 3: Interface Contract Validation (Do the seams match?)
Lens: "Even if each piece works internally, do they fit together?"
For every boundary between systems (client-server, package-consumer, DTO-schema):
1. Schema alignment — compare field names, types, casing, and nesting between sender and receiver. PascalCase vs camelCase is a classic miss.
2. Response envelope — does the client expect flat data or a wrapper like { success, data, error }?
3. Auth flow — trace the auth token/key from storage to header to middleware to handler. Is every step connected?
4. Import resolution — can the importing package actually resolve the path? Check package.json exports, symlinks, barrel files (index.ts).
5. Build compatibility — check language versions, framework versions, and serialization library capabilities.
6. Environment variables — list every env var the code reads. Are they set in the deployment environment?

Output a bug table: Bug # | Description | File:Line | Evidence
Self-check: Did I literally compare the sender's output shape against the receiver's expected input, field by field? Did I check that every import path resolves? Did I verify env vars are set, not just referenced?

### Workflow Rules
1. Complete all 3 passes before writing the implementation plan. No exceptions.
2. Loop back if needed. If Pass 3 reveals issues, loop back to the relevant earlier pass and re-run it. Keep looping until Pass 3 produces no new issues.
3. Split large plans. If the implementation plan exceeds ~200 lines, split it into phases. Each phase should be independently deployable and verifiable.
4. Stop when stable. The protocol is complete when Pass 3 produces no changes to the plan.

### THEN and ONLY THEN: Write Your Implementation Plan
Based on ALL 3 passes, write your plan. Reference specific findings from each pass. The plan should:
1. Address every bug found in Pass 3
2. Use existing components found in Pass 2 (don't rebuild what exists)
3. Follow the exact data flow mapped in Pass 1
`

    const MAX_DOC_CHARS = 2000
    const MAX_PROMPT_CHARS = 50000

    const truncate = (text: string, max: number): string =>
      text.length > max ? text.slice(0, max - 3) + "..." : text

    const buildAgentPrompt = (card: { id: string; title: string; description: string; contextSnapshot: string | null; projectId: string }, _userPrompt: string): Effect.Effect<string, never> =>
      Effect.gen(function* () {
        const sections: string[] = []

        // --- 1. Identity ---
        sections.push(`## Identity

You are an autonomous build agent in the Maslow system. You are working in an isolated git worktree on a feature branch. Your job: implement the kanban card below, ensure it compiles and lints cleanly, commit your changes, and stop. The orchestrator handles push and PR creation — do NOT push or create PRs yourself.

You have access to CLAUDE.md in the repo root which defines engineering standards, patterns, and gotchas. Read it before writing code.`)

        // --- 2. Project context ---
        const project = yield* db.getProject(card.projectId).pipe(
          Effect.orElseSucceed(() => null)
        )
        if (project) {
          let projectSection = `## Project: ${project.name}\n\n`
          if (project.description) {
            projectSection += `${project.description}\n\n`
          }

          // Inject project documents (brief, instructions, assumptions)
          const docs = yield* db.getProjectDocuments(card.projectId).pipe(
            Effect.orElseSucceed(() => [] as Array<{ type: string; title: string; content: string }>)
          )
          const docTypes = ["brief", "instructions", "assumptions"] as const
          for (const docType of docTypes) {
            const doc = docs.find(d => d.type === docType)
            if (doc && doc.content.trim()) {
              projectSection += `### ${doc.title || docType}\n${truncate(doc.content, MAX_DOC_CHARS)}\n\n`
            }
          }

          sections.push(projectSection.trimEnd())
        }

        // --- 3. Architecture decisions ---
        const decisions = yield* db.getDecisions(card.projectId).pipe(
          Effect.orElseSucceed(() => [] as Array<{ title: string; reasoning: string; tradeoffs: string }>)
        )
        if (decisions.length > 0) {
          let decisionSection = `## Architecture Decisions\n\n`
          for (const d of decisions.slice(0, 10)) {
            decisionSection += `- **${d.title}**: ${truncate(d.reasoning, 200)}`
            if (d.tradeoffs) {
              decisionSection += ` (tradeoffs: ${truncate(d.tradeoffs, 100)})`
            }
            decisionSection += `\n`
          }
          sections.push(decisionSection.trimEnd())
        }

        // --- 4. Board context (sibling awareness) ---
        const board = yield* kanban.getBoard(card.projectId).pipe(
          Effect.orElseSucceed(() => ({ backlog: [], in_progress: [], done: [] }))
        )
        const inProgress = board.in_progress.filter(c => c.id !== card.id)
        const recentDone = board.done.slice(0, 10)

        if (inProgress.length > 0 || recentDone.length > 0) {
          let boardSection = `## Board Context\n\n`
          if (inProgress.length > 0) {
            boardSection += `**In Progress (other agents working now):**\n`
            for (const c of inProgress) {
              boardSection += `- "${c.title}" — ${c.assignedAgent || "unassigned"}, status: ${c.agentStatus || "unknown"}\n`
            }
            boardSection += `\n`
          }
          if (recentDone.length > 0) {
            boardSection += `**Recently Completed:**\n`
            for (const c of recentDone) {
              boardSection += `- "${c.title}"\n`
            }
          }
          sections.push(boardSection.trimEnd())
        }

        // --- 5. Card brief (the actual task) ---
        let taskSection = `## Task\n\n**${card.title}**\n\n${card.description}`
        if (card.contextSnapshot) {
          taskSection += `\n\n### Previous Context\n\nThis card was previously worked on. Here's where we left off:\n\n${card.contextSnapshot}`
        }
        sections.push(taskSection)

        // --- 6. Steering corrections ---
        const steeringBlock = yield* steering.buildPromptBlock(card.projectId)
        if (steeringBlock) {
          sections.push(steeringBlock)
        }

        // --- 7. Deep research protocol ---
        sections.push(DEEP_RESEARCH_PROTOCOL)

        // --- 8. Completion checklist ---
        sections.push(`## When Done

1. Ensure all changes compile and lint cleanly (\`npm run type-check && npm run lint\`)
2. Create a verification-prompt.md in the repo root with:
   - The card title and goals
   - Acceptance criteria (checklist)
   - Specific verification steps
   - List of files changed
3. Commit all changes with a descriptive message
4. Do NOT push or create a PR — the orchestrator handles that`)

        // --- Assemble with token budget guard ---
        let prompt = sections.join("\n\n")

        // Progressive truncation if over budget
        if (prompt.length > MAX_PROMPT_CHARS) {
          // Drop decisions first (least critical)
          sections.splice(sections.findIndex(s => s.startsWith("## Architecture Decisions")), 1)
          prompt = sections.join("\n\n")
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
          // Drop board context next
          sections.splice(sections.findIndex(s => s.startsWith("## Board Context")), 1)
          prompt = sections.join("\n\n")
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
          // Drop project docs last (keep identity + task + research + steering)
          const projIdx = sections.findIndex(s => s.startsWith("## Project:"))
          if (projIdx >= 0) sections.splice(projIdx, 1)
          prompt = sections.join("\n\n")
        }

        return prompt
      })

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
          const fullPrompt = yield* buildAgentPrompt({ ...card, projectId: options.projectId }, options.prompt)
          const { cmd, args } = buildAgentCommand(options.agent, fullPrompt, options.cwd)

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

          // Spawn the agent process in the isolated worktree
          const env = { ...process.env }
          delete env.ANTHROPIC_API_KEY // Force OAuth for Claude

          const child = spawn(cmd, args, {
            cwd: worktreeDir,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            env,
          })

          agentProcess.process = child

          // Close stdin — Claude CLI blocks on open stdin pipe
          child.stdin?.end()

          const addLog = (line: string) => {
            agentProcess.logs.push(line)
            if (agentProcess.logs.length > MAX_LOG_LINES) {
              agentProcess.logs.shift()
            }
            broadcast({ type: "agent.log", cardId: options.cardId, line })
          }

          // Stream stdout (JSONL from --output-format stream-json)
          let stdoutBuffer = ""
          child.stdout?.on("data", (chunk: Buffer) => {
            stdoutBuffer += chunk.toString()
            const lines = stdoutBuffer.split("\n")
            stdoutBuffer = lines.pop() || ""
            for (const line of lines) {
              if (!line.trim()) continue
              addLog(line)

              // Parse stream-json to detect result messages with token usage
              try {
                const message = JSON.parse(line)
                if (message.type === "result" && message.modelUsage) {
                  const modelUsage = Object.values(message.modelUsage)[0] as Record<string, number> | undefined
                  if (modelUsage) {
                    Effect.runPromise(
                      db.insertTokenUsage({
                        cardId: options.cardId,
                        projectId: options.projectId,
                        agent: options.agent,
                        inputTokens: modelUsage.inputTokens || 0,
                        outputTokens: modelUsage.outputTokens || 0,
                        cacheReadTokens: modelUsage.cacheReadInputTokens || 0,
                        cacheWriteTokens: modelUsage.cacheCreationInputTokens || 0,
                        costUsd: message.total_cost_usd ?? 0,
                        createdAt: Date.now(),
                      })
                    ).catch((err) => {
                      addLog(`[orchestrator] Failed to save token usage: ${err}`)
                    })
                  }
                }
              } catch {
                // Not valid JSON — normal for non-JSON log lines
              }
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

          // Clean up worktree helper
          const cleanupWorktree = () => {
            try {
              execSync(`git worktree remove ${worktreeDir} --force`, { cwd: options.cwd, stdio: "pipe" })
            } catch {
              // Best effort — worktree may already be gone
            }
          }

          // P0: Helper to send failure notification with stderr context
          const notifyFailure = (reason: string) => {
            const stderrTail = agentProcess.logs
              .filter(l => l.startsWith("[stderr]"))
              .slice(-20)
              .join("\n")
            const msg = `🔴 Agent failed on "${card.title}"\n\nReason: ${reason}${stderrTail ? `\n\nLast stderr:\n\`\`\`\n${stderrTail.slice(0, 500)}\n\`\`\`` : ""}`
            Effect.runPromise(
              telegram.sendMessage(chatId, msg).pipe(Effect.ignore)
            ).catch(() => {})
          }

          // Agent timeout — kill after 30 min
          const timeoutTimer = setTimeout(() => {
            if (agentProcess.status === "running" && child && !child.killed) {
              agentProcess.status = "failed"
              const reason = `Timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`
              addLog(`[orchestrator] ${reason}`)
              broadcast({ type: "agent.timeout", cardId: options.cardId })
              child.kill("SIGTERM")
              setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL")
              }, 5000)

              Effect.runPromise(
                Effect.gen(function* () {
                  yield* kanban.updateAgentStatus(options.cardId, "failed", "Agent timed out")
                  yield* db.logAudit("agent", options.cardId, "agent.timeout", {
                    cardId: options.cardId,
                    agent: options.agent,
                    timeoutMs: AGENT_TIMEOUT_MS,
                  })
                })
              ).catch(console.error)
            }
          }, AGENT_TIMEOUT_MS)

          // Handle process exit
          child.on("close", (code) => {
            clearTimeout(timeoutTimer)
            if (code === 0) {
              agentProcess.status = "completed"
              addLog(`[orchestrator] Agent completed successfully`)
              broadcast({ type: "agent.completed", cardId: options.cardId })

              // Notify success via Telegram
              Effect.runPromise(
                Effect.gen(function* () {
                  yield* kanban.completeWork(options.cardId)
                  yield* kanban.saveContext(options.cardId, `Agent ${options.agent} completed. Branch: ${branchName}`)
                  yield* db.logAudit("agent", options.cardId, "agent.completed", {
                    cardId: options.cardId,
                    agent: options.agent,
                    branchName,
                  })
                  yield* telegram.sendMessage(
                    chatId,
                    `✅ Agent completed "${card.title}" (branch: ${branchName})`
                  ).pipe(Effect.ignore)
                })
              ).then(() => {
                // Push branch and open PR (from worktree dir)
                try {
                  execSync(`git push -u origin ${branchName}`, { cwd: worktreeDir, stdio: "pipe" })
                  const prTitle = card.title.slice(0, 70)
                  const prBody = `## Card\n${card.title}\n\n## Description\n${card.description}\n\n## Agent\n${options.agent}\n\nSee \`verification-prompt.md\` for verification criteria.`
                  execSync(`gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --head ${branchName}`, {
                    cwd: worktreeDir,
                    stdio: "pipe",
                  })
                  addLog(`[orchestrator] PR created on branch ${branchName}`)
                } catch (err) {
                  addLog(`[orchestrator] Failed to create PR: ${err}`)
                }
                cleanupWorktree()
              }).catch((err) => {
                addLog(`[orchestrator] Post-completion error: ${err}`)
                cleanupWorktree()
              })
            } else {
              agentProcess.status = "failed"
              const reason = `Process exited with code ${code}`
              addLog(`[orchestrator] Agent failed: ${reason}`)
              broadcast({ type: "agent.failed", cardId: options.cardId, error: reason })
              notifyFailure(reason)

              Effect.runPromise(
                Effect.gen(function* () {
                  yield* kanban.updateAgentStatus(options.cardId, "failed", reason)
                  yield* db.logAudit("agent", options.cardId, "agent.failed", {
                    cardId: options.cardId,
                    agent: options.agent,
                    exitCode: code,
                    reason,
                  })
                })
              ).catch(console.error)
              cleanupWorktree()
            }
          })

          child.on("error", (err) => {
            clearTimeout(timeoutTimer)
            agentProcess.status = "failed"
            addLog(`[orchestrator] Spawn error: ${err.message}`)
            broadcast({ type: "agent.failed", cardId: options.cardId, error: err.message })
            notifyFailure(`Spawn error: ${err.message}`)

            Effect.runPromise(
              Effect.gen(function* () {
                yield* kanban.updateAgentStatus(options.cardId, "failed", err.message)
                yield* db.logAudit("agent", options.cardId, "agent.failed", {
                  cardId: options.cardId,
                  agent: options.agent,
                  reason: err.message,
                })
              })
            ).catch(console.error)
            cleanupWorktree()
          })

          agents.set(options.cardId, agentProcess)
          broadcast({ type: "agent.spawned", cardId: options.cardId, agent: options.agent })

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

      shutdownAll: () =>
        Effect.gen(function* () {
          const running = [...agents.values()].filter(
            a => a.status === "running" && a.process && !a.process.killed
          )
          if (running.length === 0) return

          yield* Effect.log(`Graceful shutdown: stopping ${running.length} running agent(s)...`)

          // Send SIGTERM to all
          for (const agent of running) {
            agent.process!.kill("SIGTERM")
            agent.logs.push("[orchestrator] SIGTERM sent (server shutting down)")
          }

          // Wait up to 30s for graceful exit
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

          // SIGKILL any survivors
          for (const agent of running) {
            if (agent.process && !agent.process.killed) {
              agent.process.kill("SIGKILL")
              agent.logs.push("[orchestrator] SIGKILL sent (shutdown timeout)")
            }
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
