/**
 * Heartbeat Service
 *
 * 10-minute pulse that checks the kanban board for work and spawns agents
 * via AgentOrchestrator. Replaces AutonomousWorker — kanban is the single
 * source of truth for what needs doing.
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
import { AppPersistence } from "./AppPersistence.js"
import type { KanbanCard } from "@maslow/shared"
import { Telegram } from "./Telegram.js"
import { ClaudeMem } from "./ClaudeMem.js"
import { runVerification, computeCodebaseMetrics } from "./protocols/VerificationProtocol.js"

export interface HeartbeatService {
  /** Start the heartbeat schedules (builders + synthesizers) */
  start(): Effect.Effect<void, Error>

  /** Stop all heartbeat schedules */
  stop(): Effect.Effect<void, Error>

  /**
   * Submit a task brief — creates a kanban card and optionally
   * triggers immediate execution via tick()
   */
  submitTaskBrief(brief: string, options?: {
    projectId?: string
    immediate?: boolean
    priority?: number
  }): Effect.Effect<KanbanCard, Error>

  /** Force a builder heartbeat tick right now (manual trigger / testing) */
  tick(): Effect.Effect<void, Error>

  /** Force a synthesizer heartbeat right now (manual trigger / testing) */
  synthesize(): Effect.Effect<void, Error>
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

    const synthesize = (): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* Effect.log("Synthesizer heartbeat starting...")

        // Gate 2: Find cards that passed Gate 1 and attempt merge verification
        const verifiedCards = yield* db.getCardsByVerificationStatus("branch_verified")

        if (verifiedCards.length > 0) {
          yield* Effect.log(`Synthesizer: ${verifiedCards.length} card(s) ready for Gate 2 merge verification`)
        }

        const integrationBranch = "integrate/agent-features"
        let mergedCount = 0
        let failedCount = 0

        for (const card of verifiedCards) {
          const branchMatch = card.contextSnapshot?.match(/Branch: (.+)/)
          const branchName = branchMatch?.[1]
          if (!branchName) {
            yield* Effect.logWarning(`Card ${card.id} has no branch name in context — skipping`)
            continue
          }

          yield* Effect.log(`Gate 2: Attempting merge of ${branchName} into ${integrationBranch}`)
          broadcast({ type: "verification.started", cardId: card.id, gate: "merge" })

          const mergeDir = `${config.workspace.path}/.worktrees/merge-${card.id.slice(0, 8)}`

          try {
            // Create worktree on integration branch
            try {
              execSync(`git worktree add ${mergeDir} ${integrationBranch}`, {
                cwd: config.workspace.path,
                stdio: "pipe",
              })
            } catch {
              yield* Effect.logWarning(`Failed to create merge worktree for card ${card.id}`)
              continue
            }

            // Symlink node_modules
            try {
              execSync(`ln -sf ${config.workspace.path}/node_modules ${mergeDir}/node_modules`, { stdio: "pipe" })
            } catch { /* best effort */ }

            // Attempt merge
            try {
              execSync(`git merge --no-ff ${branchName} -m "Merge ${branchName}"`, {
                cwd: mergeDir,
                stdio: "pipe",
                timeout: 30_000,
              })
            } catch (mergeErr) {
              // Merge conflict — abort and mark failed
              try { execSync(`git merge --abort`, { cwd: mergeDir, stdio: "pipe" }) } catch { /* already clean */ }
              const errMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
              yield* db.updateCardVerification(card.id, "merge_failed", `Merge conflict: ${errMsg.slice(0, 1000)}`)
              yield* kanban.updateAgentStatus(card.id, "blocked", `Merge conflict with ${integrationBranch}`)
              yield* db.logAudit("agent", card.id, "verification.merge_conflict", { branchName })
              broadcast({ type: "verification.failed", cardId: card.id, gate: "merge", output: `Merge conflict: ${errMsg.slice(0, 500)}` })
              yield* telegram.sendMessage(chatId, `Gate 2: Merge conflict for "${card.title}" — needs manual resolution`).pipe(Effect.ignore)
              failedCount++
              continue
            }

            // Run verification on merged state
            const mergeCheck = runVerification(mergeDir)

            if (mergeCheck.passed) {
              // Gate 2 PASSED — push integration branch and move card to done
              try {
                execSync(`git push origin ${integrationBranch}`, { cwd: mergeDir, stdio: "pipe" })
              } catch (pushErr) {
                yield* Effect.logWarning(`Push failed after merge: ${pushErr}. Merge is local only.`)
              }

              yield* kanban.completeWork(card.id)
              yield* db.updateCardVerification(card.id, "merge_verified")
              yield* db.logAudit("agent", card.id, "verification.merge_passed", { branchName })
              broadcast({ type: "verification.passed", cardId: card.id, gate: "merge" })
              yield* telegram.sendMessage(chatId, `Gate 2 PASSED: "${card.title}" merged into ${integrationBranch}`).pipe(Effect.ignore)
              mergedCount++
            } else {
              // Gate 2 FAILED — revert merge, mark card
              try {
                execSync(`git reset --hard HEAD~1`, { cwd: mergeDir, stdio: "pipe" })
              } catch { /* best effort revert */ }

              const failureOutput = [
                mergeCheck.tscOutput ? `TSC:\n${mergeCheck.tscOutput}` : "",
                mergeCheck.lintOutput ? `LINT:\n${mergeCheck.lintOutput}` : "",
                mergeCheck.testOutput ? `TEST:\n${mergeCheck.testOutput}` : "",
              ].filter(Boolean).join("\n\n").slice(0, 5000)

              yield* db.updateCardVerification(card.id, "merge_failed", failureOutput)
              yield* kanban.updateAgentStatus(card.id, "blocked", `Gate 2 failed: merge breaks checks`)
              yield* db.logAudit("agent", card.id, "verification.merge_failed", { branchName })
              broadcast({ type: "verification.failed", cardId: card.id, gate: "merge", output: failureOutput.slice(0, 500) })
              yield* telegram.sendMessage(chatId, `Gate 2 FAILED: "${card.title}" breaks integration branch\n\n${failureOutput.slice(0, 500)}`).pipe(Effect.ignore)
              failedCount++
            }
          } finally {
            // Always clean up merge worktree
            try {
              execSync(`git worktree remove ${mergeDir} --force`, {
                cwd: config.workspace.path,
                stdio: "pipe",
              })
            } catch { /* best effort */ }
          }
        }

        // Collect campaign metrics
        const projects = yield* db.getProjects()
        for (const project of projects.filter(p => p.status === "active")) {
          const campaigns = yield* db.getCampaigns(project.id)
          for (const campaign of campaigns.filter(c => c.status === "active")) {
            const cards = yield* db.getCardsByCampaign(campaign.id)
            const completed = cards.filter(c => c.column === "done")
            const remaining = cards.filter(c => c.column === "backlog")
            const blocked = cards.filter(c => c.agentStatus === "blocked")

            const currentMetrics = computeCodebaseMetrics(config.workspace.path)
            const baseline = campaign.baselineMetrics ?? currentMetrics

            // Save baseline on first report if not set
            if (!campaign.baselineMetrics) {
              yield* db.updateCampaign(campaign.id, { baselineMetrics: currentMetrics })
            }

            yield* db.createCampaignReport({
              campaignId: campaign.id,
              baselineMetrics: baseline,
              currentMetrics,
              cardsCompleted: completed.length,
              cardsRemaining: remaining.length,
              cardsBlocked: blocked.length,
              delta: {
                lintWarnings: currentMetrics.lintWarnings - baseline.lintWarnings,
                lintErrors: currentMetrics.lintErrors - baseline.lintErrors,
                anyCount: currentMetrics.anyCount - baseline.anyCount,
                testFileCount: currentMetrics.testFileCount - baseline.testFileCount,
              },
              createdAt: Date.now(),
            })

            // Campaign-drain trigger: if backlog is empty, campaign is complete
            if (remaining.length === 0 && cards.length > 0) {
              yield* db.updateCampaign(campaign.id, { status: "completed" })
              yield* db.logAudit("campaign", campaign.id, "campaign.completed", {
                cardsCompleted: completed.length,
                cardsBlocked: blocked.length,
              })
              const deltaAny = currentMetrics.anyCount - baseline.anyCount
              const deltaTests = currentMetrics.testFileCount - baseline.testFileCount
              yield* telegram.sendMessage(
                chatId,
                `Campaign "${campaign.name}" COMPLETE\n\n` +
                `${completed.length}/${cards.length} cards done, ${blocked.length} blocked\n` +
                `any: ${baseline.anyCount} → ${currentMetrics.anyCount} (${deltaAny >= 0 ? "+" : ""}${deltaAny})\n` +
                `lint: ${currentMetrics.lintWarnings}w/${currentMetrics.lintErrors}e\n` +
                `tests: ${baseline.testFileCount} → ${currentMetrics.testFileCount} files (${deltaTests >= 0 ? "+" : ""}${deltaTests})`
              ).pipe(Effect.ignore)
              broadcast({
                type: "campaign.report",
                campaignId: campaign.id,
                report: {
                  id: "final",
                  campaignId: campaign.id,
                  baselineMetrics: baseline,
                  currentMetrics,
                  cardsCompleted: completed.length,
                  cardsRemaining: 0,
                  cardsBlocked: blocked.length,
                  delta: {
                    lintWarnings: currentMetrics.lintWarnings - baseline.lintWarnings,
                    lintErrors: currentMetrics.lintErrors - baseline.lintErrors,
                    anyCount: deltaAny,
                    testFileCount: deltaTests,
                  },
                  createdAt: Date.now(),
                },
              })
            } else if (completed.length > 0 || blocked.length > 0) {
              yield* telegram.sendMessage(
                chatId,
                `Campaign "${campaign.name}": ${completed.length}/${cards.length} done, ${blocked.length} blocked\n` +
                `any: ${currentMetrics.anyCount} (${currentMetrics.anyCount - baseline.anyCount >= 0 ? "+" : ""}${currentMetrics.anyCount - baseline.anyCount}) | ` +
                `lint: ${currentMetrics.lintWarnings}w/${currentMetrics.lintErrors}e | tests: ${currentMetrics.testFileCount} files`
              ).pipe(Effect.ignore)
            }
          }
        }

        // Summary stats
        const runningAgents = yield* agentOrchestrator.getRunningAgents()
        const runningCount = runningAgents.filter(a => a.status === "running").length
        const completedCount = runningAgents.filter(a => a.status === "completed").length

        yield* Effect.log(
          `Synthesizer complete: ${mergedCount} merged, ${failedCount} merge-failed, ${runningCount} running, ${completedCount} pending Gate 2`
        )

        broadcast({
          type: "system.synthesizer",
          completed: mergedCount,
          blocked: failedCount,
          timestamp: Date.now(),
        })
      })

    // Daily PR — one per project, max 1/day, at 10pm local
    const draftDailyPRs = (): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* Effect.log("Daily PR check starting...")

        // Check gh auth
        try {
          execSync("gh auth status", { stdio: "pipe" })
        } catch {
          yield* Effect.log("Daily PR: gh not authenticated — skipping")
          return
        }

        const projects = yield* db.getProjects()
        const activeProjects = projects.filter(p => p.status === "active")

        for (const project of activeProjects) {
          // Check if there are merge-verified cards since last PR
          const board = yield* kanban.getBoard(project.id)
          const recentlyDone = board.done.filter(c =>
            c.verificationStatus === "merge_verified" &&
            c.completedAt &&
            c.completedAt > Date.now() - 24 * 60 * 60 * 1000
          )

          if (recentlyDone.length === 0) {
            yield* Effect.log(`Daily PR: No new verified work for ${project.name} — skipping`)
            continue
          }

          // Build PR body from campaign reports
          const campaigns = yield* db.getCampaigns(project.id)
          const reportSections: string[] = []
          for (const campaign of campaigns) {
            const reports = yield* db.getCampaignReports(campaign.id, 1)
            if (reports.length > 0) {
              const r = reports[0]
              reportSections.push(
                `### ${campaign.name} (${campaign.status})\n` +
                `- Cards: ${r.cardsCompleted} done, ${r.cardsRemaining} remaining, ${r.cardsBlocked} blocked\n` +
                `- any: ${r.delta.anyCount >= 0 ? "+" : ""}${r.delta.anyCount} | lint: ${r.delta.lintWarnings >= 0 ? "+" : ""}${r.delta.lintWarnings}w | tests: ${r.delta.testFileCount >= 0 ? "+" : ""}${r.delta.testFileCount} files`
              )
            }
          }

          const cardList = recentlyDone.map(c => `- ${c.title}`).join("\n")
          const integrationBranch = "integrate/agent-features"
          const prTitle = `[${project.name}] Daily synthesis — ${recentlyDone.length} cards verified`
          const prBody = [
            `## Summary`,
            `${recentlyDone.length} cards passed both Gate 1 (branch) and Gate 2 (merge) verification.`,
            ``,
            `## Cards Completed`,
            cardList,
            ``,
            reportSections.length > 0 ? `## Campaign Reports\n${reportSections.join("\n\n")}` : "",
            ``,
            `## Verification`,
            `All cards passed: \`tsc --noEmit\`, \`eslint\`, \`vitest run\` on both branch and post-merge.`,
          ].filter(Boolean).join("\n")

          try {
            execSync(
              `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --base main --head ${integrationBranch}`,
              { cwd: config.workspace.path, stdio: "pipe" }
            )
            yield* Effect.log(`Daily PR: Created PR for ${project.name}`)
            yield* telegram.sendMessage(
              chatId,
              `Daily PR created for ${project.name}: ${recentlyDone.length} verified cards ready for review`
            ).pipe(Effect.ignore)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            // PR might already exist — that's fine
            if (errMsg.includes("already exists")) {
              yield* Effect.log(`Daily PR: PR already exists for ${project.name} — skipping`)
            } else {
              yield* Effect.logWarning(`Daily PR: Failed to create PR for ${project.name}: ${errMsg}`)
            }
          }
        }

        yield* Effect.log("Daily PR check complete")
      })

    const submitTaskBrief = (
      brief: string,
      options?: { projectId?: string; immediate?: boolean; priority?: number }
    ): Effect.Effect<KanbanCard, Error> =>
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

          // Builder heartbeat: every 10 minutes at :00, :10, :20, :30, :40, :50
          const builderTask = cron.schedule("0,10,20,30,40,50 * * * *", () => {
            Effect.runPromise(
              tick().pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Builder heartbeat error: ${error.message}`)
                )
              )
            )
          })

          // Synthesizer heartbeat: twice per hour at :19, :39
          const synthesizerTask = cron.schedule("19,39 * * * *", () => {
            Effect.runPromise(
              synthesize().pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Synthesizer heartbeat error: ${error.message}`)
                )
              )
            )
          })

          // Daily PR: once per day at 10pm local
          const dailyPRTask = cron.schedule("0 22 * * *", () => {
            Effect.runPromise(
              draftDailyPRs().pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Daily PR error: ${error.message}`)
                )
              )
            )
          })

          tasks.push(builderTask)
          tasks.push(synthesizerTask)
          tasks.push(dailyPRTask)
          yield* Effect.log("Heartbeat started — builders every 10 min, synthesizers at :19/:39, daily PR at 10pm")

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
      synthesize,
    }
  })
)
