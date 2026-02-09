/**
 * Heartbeat Service
 *
 * 10-minute pulse that checks the kanban board for work and spawns agents
 * via AgentOrchestrator. Replaces AutonomousWorker — kanban is the single
 * source of truth for what needs doing.
 *
 * Also runs a twice-daily PR cycle that reviews completed agent branches,
 * pushes them, and creates PRs.
 *
 * Can also create kanban cards from task briefs, closing the loop between
 * "someone said do this" and "an agent is working on it."
 */

import { Context, Effect, Layer } from "effect"
import cron from "node-cron"
import { execSync } from "child_process"
import { ConfigService } from "./Config.js"
import { Kanban } from "./Kanban.js"
import { AgentOrchestrator } from "./AgentOrchestrator.js"
import { AppPersistence, type AppKanbanCard } from "./AppPersistence.js"
import { Telegram } from "./Telegram.js"
import { ClaudeMem } from "./ClaudeMem.js"

export interface HeartbeatService {
  /** Start the 10-minute heartbeat loop */
  start(): Effect.Effect<void, Error>

  /** Stop the heartbeat loop */
  stop(): Effect.Effect<void, Error>

  /**
   * Submit a task brief — creates a kanban card and optionally
   * triggers immediate execution via tick()
   */
  submitTaskBrief(brief: string, options?: {
    projectId?: string
    immediate?: boolean
    priority?: number
  }): Effect.Effect<AppKanbanCard, Error>

  /** Force a heartbeat tick right now (manual trigger / testing) */
  tick(): Effect.Effect<void, Error>

  /** Run the PR cycle — review completed branches, push, and create PRs */
  prCycle(): Effect.Effect<void, Error>
}

export class Heartbeat extends Context.Tag("Heartbeat")<
  Heartbeat,
  HeartbeatService
>() {}

// Broadcast function — set by AppServer when WebSocket is available
type BroadcastFn = (message: Record<string, unknown>) => void
let broadcast: BroadcastFn = () => {}

export function setHeartbeatBroadcast(fn: BroadcastFn) {
  broadcast = fn
}

const TICK_INTERVAL_MS = 10 * 60 * 1000
const BLOCKED_RETRY_MS = 30 * 60 * 1000
const MAX_CONCURRENT_AGENTS = 3

// Default PR cycle: 10am and 4pm daily
const DEFAULT_PR_SCHEDULE = "0 10,16 * * *"
const PR_MAX_RETRIES = 3
const PR_RETRY_DELAY_MS = 5000

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const kanban = yield* Kanban
    const agentOrchestrator = yield* AgentOrchestrator
    const db = yield* AppPersistence
    const telegram = yield* Telegram
    const _claudeMem = yield* ClaudeMem

    const chatId = config.telegram.userId
    const tasks: cron.ScheduledTask[] = []

    const tick = (): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* Effect.log("Heartbeat tick starting...")

        const projects = yield* db.getProjects()
        const activeProjects = projects.filter(p => p.status === "active")
        const runningAgents = yield* agentOrchestrator.getRunningAgents()
        const runningCount = runningAgents.filter(a => a.status === "running").length

        let spawned = 0
        let cardsQueued = 0

        for (const project of activeProjects) {
          // Skip if project already has a running agent (1-per-project rule)
          const projectHasAgent = runningAgents.some(
            a => a.projectId === project.id && a.status === "running"
          )
          if (projectHasAgent) continue

          // Check for blocked cards that might be retryable
          const board = yield* kanban.getBoard(project.id)
          const blockedCards = board.in_progress.filter(
            c => c.agentStatus === "blocked"
          )
          for (const blocked of blockedCards) {
            const blockedDuration = Date.now() - (blocked.updatedAt || 0)
            if (blockedDuration > BLOCKED_RETRY_MS) {
              yield* kanban.skipToBack(blocked.id)
              yield* Effect.log(`Heartbeat: Moved blocked card "${blocked.title}" back to backlog for retry`)
              broadcast({
                type: "heartbeat.retry",
                cardId: blocked.id,
                projectId: project.id,
                previousStatus: "blocked",
              })
            }
          }

          // Get next backlog card
          const nextCard = yield* kanban.getNext(project.id)
          if (!nextCard) continue

          cardsQueued++

          // Check global concurrency
          if (runningCount + spawned >= MAX_CONCURRENT_AGENTS) continue

          // Spawn agent
          yield* agentOrchestrator.spawnAgent({
            cardId: nextCard.id,
            projectId: project.id,
            agent: "claude",
            prompt: nextCard.description || nextCard.title,
            cwd: config.workspace.path,
          }).pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                spawned++
                broadcast({
                  type: "heartbeat.spawned",
                  cardId: nextCard.id,
                  projectId: project.id,
                  agent: "claude",
                })
                yield* telegram.sendMessage(
                  chatId,
                  `Heartbeat: Started agent on "${nextCard.title}" (${project.name})`
                ).pipe(Effect.ignore)
              })
            ),
            Effect.catchAll((err) =>
              Effect.gen(function* () {
                yield* Effect.logWarning(
                  `Heartbeat: Failed to spawn agent for card ${nextCard.id}: ${err.message}`
                )
                broadcast({
                  type: "heartbeat.error",
                  message: `Failed to spawn on "${nextCard.title}": ${err.message}`,
                })
              })
            )
          )
        }

        broadcast({
          type: "heartbeat.tick",
          timestamp: Date.now(),
          projectsScanned: activeProjects.length,
          agentsRunning: runningCount + spawned,
          cardsQueued,
        })

        if (spawned === 0) {
          broadcast({
            type: "heartbeat.idle",
            timestamp: Date.now(),
            nextTickIn: TICK_INTERVAL_MS,
          })
        }

        yield* Effect.log(
          `Heartbeat tick complete: ${activeProjects.length} projects, ${spawned} spawned, ${cardsQueued} queued`
        )
      })

    const submitTaskBrief = (
      brief: string,
      options?: { projectId?: string; immediate?: boolean; priority?: number }
    ): Effect.Effect<AppKanbanCard, Error> =>
      Effect.gen(function* () {
        // Resolve project
        let projectId = options?.projectId
        if (!projectId) {
          const projects = yield* db.getProjects()
          const activeProjects = projects.filter(p => p.status === "active")
          const briefLower = brief.toLowerCase()

          for (const p of activeProjects) {
            if (briefLower.includes(p.name.toLowerCase())) {
              projectId = p.id
              break
            }
          }

          if (!projectId && activeProjects.length > 0) {
            projectId = activeProjects[0].id
          }

          if (!projectId) {
            return yield* Effect.fail(
              new Error("No active project found. Create a project first.")
            )
          }
        }

        // Extract title from first sentence
        const firstSentence = brief.split(/[.!?\n]/)[0]
        const title = firstSentence.length > 80
          ? firstSentence.slice(0, 77) + "..."
          : firstSentence

        // Create kanban card
        const card = yield* kanban.createCard(projectId, title, brief, "backlog")

        broadcast({
          type: "heartbeat.cardCreated",
          cardId: card.id,
          projectId,
          title: card.title,
          source: "submitTaskBrief",
        })

        yield* Effect.log(`Heartbeat: Task brief → card "${title}" (${card.id})`)

        // Trigger immediate tick if requested (default: yes)
        if (options?.immediate !== false) {
          yield* tick().pipe(Effect.ignore)
        }

        return card
      })

    // Extract branch name from context snapshot (format: "Agent claude completed. Branch: agent/claude/...")
    const extractBranch = (snapshot: string | null): string | null => {
      if (!snapshot) return null
      const match = snapshot.match(/Branch:\s*(agent\/[^\s]+)/)
      return match ? match[1] : null
    }

    const prCycle = (): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* Effect.log("PR cycle starting...")

        // Check gh auth before attempting anything
        try {
          execSync("gh auth status", { stdio: "pipe" })
        } catch {
          yield* Effect.log("PR cycle: gh not authenticated — skipping")
          return
        }

        const projects = yield* db.getProjects()
        const activeProjects = projects.filter(p => p.status === "active")
        let prsCreated = 0
        const prSummary: string[] = []

        for (const project of activeProjects) {
          const board = yield* kanban.getBoard(project.id)
          const completedCards = board.done.filter(c =>
            c.agentStatus === "completed" && c.contextSnapshot
          )

          for (const card of completedCards) {
            const branchName = extractBranch(card.contextSnapshot)
            if (!branchName) continue

            // Check if branch exists locally
            try {
              execSync(`git rev-parse --verify ${branchName}`, {
                cwd: config.workspace.path,
                stdio: "pipe",
              })
            } catch {
              yield* Effect.log(`PR cycle: Branch ${branchName} not found locally — skipping`)
              continue
            }

            // Check if a PR already exists for this branch
            try {
              const existing = execSync(`gh pr list --head ${branchName} --json number --limit 1`, {
                cwd: config.workspace.path,
                stdio: "pipe",
              }).toString().trim()
              const prs = JSON.parse(existing) as Array<{ number: number }>
              if (prs.length > 0) {
                yield* Effect.log(`PR cycle: PR #${prs[0].number} already exists for ${branchName} — skipping`)
                continue
              }
            } catch {
              // gh pr list failed — skip this branch
              yield* Effect.log(`PR cycle: Failed to check existing PRs for ${branchName} — skipping`)
              continue
            }

            // Push and create PR with retry
            const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
            let created = false

            for (let attempt = 1; attempt <= PR_MAX_RETRIES; attempt++) {
              try {
                execSync(`git push -u origin ${branchName}`, {
                  cwd: config.workspace.path,
                  stdio: "pipe",
                })
                const prTitle = card.title.slice(0, 70)
                const prBody = `## Card\n${card.title}\n\n## Description\n${card.description}\n\n## Agent\n${card.assignedAgent || "unknown"}\n\nSee \`verification-prompt.md\` for verification criteria.`
                execSync(`gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --head ${branchName}`, {
                  cwd: config.workspace.path,
                  stdio: "pipe",
                })
                prsCreated++
                prSummary.push(`- "${card.title}" (${branchName})`)
                created = true
                yield* Effect.log(`PR cycle: Created PR for "${card.title}" on ${branchName}`)
                break
              } catch (err) {
                yield* Effect.log(`PR cycle: Push/PR attempt ${attempt}/${PR_MAX_RETRIES} failed for ${branchName}: ${err}`)
                if (attempt < PR_MAX_RETRIES) {
                  yield* Effect.tryPromise({
                    try: () => delay(PR_RETRY_DELAY_MS),
                    catch: () => new Error("delay failed"),
                  })
                }
              }
            }

            if (!created) {
              yield* Effect.log(`PR cycle: All attempts failed for ${branchName}`)
            }
          }
        }

        // Report results
        if (prsCreated > 0) {
          const msg = `📋 PR cycle: Created ${prsCreated} PR(s)\n\n${prSummary.join("\n")}`
          yield* telegram.sendMessage(chatId, msg).pipe(Effect.ignore)
        }

        broadcast({
          type: "heartbeat.prCycle",
          timestamp: Date.now(),
          prsCreated,
        })

        yield* Effect.log(`PR cycle complete: ${prsCreated} PR(s) created`)
      })

    return {
      start: () =>
        Effect.gen(function* () {
          yield* Effect.log("Starting heartbeat (10-min interval)...")

          // P0: Startup reconciliation — reset stuck cards from previous run
          const projects = yield* db.getProjects()
          let resetCount = 0
          for (const project of projects.filter(p => p.status === "active")) {
            const board = yield* kanban.getBoard(project.id)
            for (const card of board.in_progress) {
              if (card.agentStatus === "running" || card.agentStatus === "blocked") {
                yield* kanban.skipToBack(card.id)
                resetCount++
                yield* Effect.log(`Startup reconciliation: Reset stuck card "${card.title}" → backlog`)
              }
            }
          }
          if (resetCount > 0) {
            yield* telegram.sendMessage(
              chatId,
              `🔄 Startup reconciliation: Reset ${resetCount} stuck card(s) to backlog.`
            ).pipe(Effect.ignore)
          }

          const heartbeatTask = cron.schedule("*/10 * * * *", () => {
            Effect.runPromise(
              tick().pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Heartbeat error: ${error.message}`)
                )
              )
            )
          })

          tasks.push(heartbeatTask)

          // PR cycle — twice daily (configurable via PR_SCHEDULE env var)
          const prSchedule = process.env.PR_SCHEDULE || DEFAULT_PR_SCHEDULE
          const prTask = cron.schedule(prSchedule, () => {
            Effect.runPromise(
              prCycle().pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`PR cycle error: ${error.message}`)
                )
              )
            )
          })
          tasks.push(prTask)

          yield* Effect.log(`Heartbeat started — kanban every 10 min, PR cycle at "${prSchedule}"`)

          // P2: Immediate first tick so we don't wait up to 10 min after restart
          yield* tick().pipe(
            Effect.catchAll((error) =>
              Effect.logError(`Heartbeat first-tick error: ${error.message}`)
            )
          )
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Effect.log("Stopping heartbeat...")
          tasks.forEach(task => task.stop())
          tasks.length = 0
        }),

      submitTaskBrief,
      tick,
      prCycle,
    }
  })
)
