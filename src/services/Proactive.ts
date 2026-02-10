/**
 * Proactive Intelligence Service
 *
 * DESIGN INTENT: Runs scheduled cron tasks so the system can reach out to the user without being prompted.
 *
 * Scheduled tasks for proactive check-ins, reminders, and monitoring.
 */

// ─── External Imports ───────────────────────────────────────────────

import { Context, Effect, Layer } from "effect"
import cron from "node-cron"

// ─── Internal Imports ───────────────────────────────────────────────

import { Telegram } from "./Telegram.js"
import { ClaudeMem } from "./ClaudeMem.js"
import { ConfigService } from "./Config.js"

// ─── Constants ──────────────────────────────────────────────────────

const LOG_PREFIX = "[Proactive]"

// ─── Types ──────────────────────────────────────────────────────────

export interface ProactiveService {
  /**
   * Start all scheduled tasks
   */
  start(): Effect.Effect<void, Error>

  /**
   * Stop all scheduled tasks
   */
  stop(): Effect.Effect<void, Error>
}

// ─── Service Tag ────────────────────────────────────────────────────

export class Proactive extends Context.Tag("Proactive")<
  Proactive,
  ProactiveService
>() {}

// ─── Implementation ─────────────────────────────────────────────────

export const ProactiveLive = Layer.effect(
  Proactive,
  Effect.gen(function* () {
    const telegram = yield* Telegram
    const claudeMem = yield* ClaudeMem
    const config = yield* ConfigService

    const chatId = config.telegram.userId
    const tasks: cron.ScheduledTask[] = []

    return {
      start: () =>
        Effect.gen(function* () {
          yield* Effect.log("Starting proactive intelligence tasks...")

          // Morning check-in (9am every day)
          const morningTask = cron.schedule("0 9 * * *", () => {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* Effect.log("Running morning check-in...")

                const reminders = yield* claudeMem.query(
                  "pending reminders and tasks for today"
                )

                if (reminders && reminders.trim().length > 0) {
                  yield* telegram.sendMessage(
                    chatId,
                    `☀️ Good morning!\n\n${reminders}`
                  )
                } else {
                  yield* telegram.sendMessage(
                    chatId,
                    `☀️ Good morning! No urgent reminders for today.`
                  )
                }
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Morning check-in failed: ${error.message}`)
                )
              )
            )
          })

          tasks.push(morningTask)

          // Evening reflection (8pm every day)
          const eveningTask = cron.schedule("0 20 * * *", () => {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* Effect.log("Running evening reflection...")

                const today = yield* claudeMem.query("what Trevor worked on today")

                if (today && today.trim().length > 0) {
                  yield* telegram.sendMessage(
                    chatId,
                    `📊 Daily wrap-up:\n${today}\n\nAnything to capture before EOD?`
                  )
                } else {
                  yield* telegram.sendMessage(
                    chatId,
                    `📊 Daily wrap-up: No significant activity logged today.\n\nAnything to capture?`
                  )
                }
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Evening reflection failed: ${error.message}`)
                )
              )
            )
          })

          tasks.push(eveningTask)

          // Deadline monitor (every 2 hours)
          const deadlineTask = cron.schedule("0 */2 * * *", () => {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* Effect.log("Running deadline monitor...")

                const deadlines = yield* claudeMem.query(
                  "deadlines in next 24 hours"
                )

                if (deadlines && deadlines.trim().length > 0) {
                  yield* telegram.sendMessage(chatId, `⏰ Upcoming:\n${deadlines}`)
                }
                // Don't send anything if no deadlines
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Deadline monitor failed: ${error.message}`)
                )
              )
            )
          })

          tasks.push(deadlineTask)

          yield* Effect.log(
            `Started ${tasks.length} proactive intelligence tasks`
          )
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Effect.log("Stopping proactive intelligence tasks...")
          tasks.forEach((task) => task.stop())
          tasks.length = 0
        }),
    }
  })
)
