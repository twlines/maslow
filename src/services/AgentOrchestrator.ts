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
    const steering = yield* SteeringEngine

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

    const DEEP_RESEARCH_PROTOCOL = `## Deep Research Protocol (MANDATORY)

Before writing ANY code, you MUST complete all 6 research passes. Do not skip passes. Each pass has a specific adversarial lens.

### Pass 1: Forward Trace (Understand the Happy Path)
Lens: "What does this code do today?"
1. Trace the entry point — find the user action, API call, or trigger that starts the flow.
2. Follow every function call — read each file, note the exact line numbers.
3. Document the data shape at each boundary (function args, API request/response, DTOs).
4. Map the dependency chain — what packages, services, and external APIs are involved?
5. Identify the exit point — where does the result surface to the user?

Output a trace document listing every file involved and the data transformations at each step.
Self-check: Can I draw the complete flow from trigger to user-visible result? Did I read every file, or did I assume?

### Pass 2: Inventory Audit (What exists but isn't connected?)
Lens: "What did I miss? What's built but not wired?"
1. Search for siblings — if you found FooService.ts, search for *Service* in the same directory. List ALL of them.
2. Search for pipelines — find every pipeline definition, not just the one currently called.
3. Check reference documents — look for design briefs, architecture docs, READMEs, CLAUDE.md, PLAN.md.
4. Cross-reference — for every component in the trace, ask: "Is there a newer/better/more complete version that exists but isn't used?"
5. Check the card description — did you trace EVERYTHING the card asks about, or just a subset?

Output an inventory table: Component | Code Exists? | Wired In? | Status
Self-check: Did I search broadly (glob patterns, not just exact names)? Does my inventory cover 100% of components in this domain?

### Pass 3: Interface Contract Validation (Do the seams match?)
Lens: "Even if each piece works internally, do they fit together?"
For every boundary between systems (client-server, package-consumer, DTO-schema):
1. Schema alignment — compare field names, types, casing between sender and receiver.
2. Response envelope — does the client expect flat data or a wrapper like { ok, data, error }?
3. Auth flow — trace the auth token/key from storage to header to middleware to handler. Is every step connected?
4. Import resolution — can the importing package actually resolve the path? Check package.json exports, barrel files.
5. Build compatibility — check TypeScript strict mode, framework versions, serialization.
6. Environment variables — list every env var the code reads. Are they set?

Output a bug table: Bug # | Description | File:Line | Evidence
Self-check: Did I literally compare the sender's output shape against the receiver's expected input, field by field?

### Pass 4: Adversarial Audit (What breaks under stress?)
Lens: "What happens when things go wrong?"
1. Timeout analysis — what happens when external calls (APIs, DB, WebSocket, child processes) hang? Are there timeouts on every external call? What's the cascade if one times out?
2. Memory analysis — are there unbounded buffers, growing arrays, uncleaned event listeners, or streams that never close?
3. Concurrency & race conditions — are there concurrent writes? Stale reads? Ordering assumptions that could be violated? What if the same action fires twice simultaneously?
4. Error path audit — trace every catch block. Does it swallow errors silently? Does it leak internal details? Does it leave state inconsistent?
5. Edge cases — empty arrays, null values, missing optional fields, unicode, very long strings, zero-length inputs, negative numbers, boundary values.
6. Security — injection vectors (SQL, shell, XSS), auth bypasses, credential leaks in logs or error messages, SSRF, path traversal.
7. Middleware ordering — are middleware/interceptors in the right order? Does auth run before validation? Does logging capture errors?
8. Deployment dependencies — what happens if a dependency (DB, Redis, external API) is down at startup? Does the service crash or degrade gracefully?

Output: A risk table: Risk # | Severity | Description | Mitigation
Self-check: Did I trace every error path? Did I check for silent failures? Are there unbounded operations? Did I verify timeouts on every external call?

### Pass 5: Expert Persona Audit (Would a specialist approve this?)
Lens: "What would a domain expert critique about this plan?"
1. Identify relevant specialist personas — based on the task domain, select 2-4 expert personas. Examples: HIPAA Compliance Officer, Design Systems Lead, Database Architect, Product Owner, Security Engineer, DevOps Engineer, Performance Engineer.
2. Generate adversarial critique prompts — for each persona, ask: "If I showed this plan to a [persona], what would they flag as wrong, missing, or risky?"
3. Document each persona's critique — write out the specific concerns each expert would raise, with concrete examples.
4. Integrate feedback — update the plan to address legitimate concerns. Note which critiques you chose NOT to address and why.

Output: A persona feedback table: Persona | Concern | Severity | Addressed? | Resolution
Self-check: Did I pick personas relevant to THIS specific task? Did I actually change the plan based on feedback? Would each persona sign off?

### Pass 6: Plan Stress Test (Simulate execution before committing)
Lens: "If I execute this plan step by step right now, what goes wrong?"
1. Simulate execution — mentally walk through each step as if you're executing it. What file do you open first? What do you type? What happens next?
2. Verify dependency ordering — does step 3 depend on something created in step 5? Are there circular dependencies in the plan itself?
3. Check verification feasibility — for each step, can you actually verify it worked? What does "done" look like? How do you test it?
4. Rollback safety — if step 4 fails, can you undo steps 1-3? Is there a point of no return?
5. Missing steps — are there implicit steps you assumed but didn't write down? (e.g., "install dependency", "run migration", "restart server")
6. Scope creep check — does any step do more than what was asked? Does the plan introduce unnecessary complexity?

Output: An execution trace: Step | Action | Depends On | Verifiable? | Rollback? | Issues
Self-check: Did I find ordering issues? Are there implicit assumptions? Is every step independently verifiable? Does the plan do exactly what was asked — no more, no less?

### Workflow Rules
1. Complete all 6 passes before writing the implementation plan. No exceptions.
2. Loop back if needed. If Pass 6 reveals issues, loop back to the relevant earlier pass and re-run it. Keep looping until Pass 6 produces no new issues.
3. Split large plans. If the implementation plan exceeds ~200 lines, split it into phases. Each phase should be independently deployable and verifiable.
4. Stop when stable. The protocol is complete when Pass 6 produces no changes to the plan.

### THEN and ONLY THEN: Write Your Implementation Plan
Based on ALL 6 passes, write your plan. Reference specific findings from each pass. The plan should:
1. Address every bug found in Pass 3
2. Mitigate every risk identified in Pass 4
3. Incorporate expert feedback from Pass 5
4. Use existing components found in Pass 2 (don't rebuild what exists)
5. Follow the exact data flow mapped in Pass 1
6. Pass the execution simulation from Pass 6 without issues
`

    const buildAgentPrompt = (card: { title: string; description: string; contextSnapshot: string | null; projectId: string }, userPrompt: string): Effect.Effect<string, never> =>
      Effect.gen(function* () {
        let prompt = `## Task\n\nYou are working on the following kanban card:\n\n**${card.title}**\n${card.description}\n\n`

        if (card.contextSnapshot) {
          prompt += `## Previous Context\n\nThis card was previously worked on. Here's where we left off:\n\n${card.contextSnapshot}\n\n`
        }

        prompt += `## Instructions\n\n${userPrompt}\n\n`

        // Inject steering corrections (accumulated learnings)
        const steeringBlock = yield* steering.buildPromptBlock(card.projectId)
        if (steeringBlock) {
          prompt += steeringBlock + "\n"
        }

        prompt += DEEP_RESEARCH_PROTOCOL + "\n\n"

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

          const branchName = `agent/${options.agent}/${slugify(card.title)}-${options.cardId.slice(0, 8)}`
          const fullPrompt = yield* buildAgentPrompt({ ...card, projectId: options.projectId }, options.prompt)
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
