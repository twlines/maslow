/**
 * Heartbeat Service
 *
 * Periodic health checks for voice services (STT/TTS).
 * Broadcasts voice health status to all connected WebSocket clients
 * every 5 minutes and exposes last known status for other services.
 */

import { Context, Effect, Layer } from "effect"
import cron from "node-cron"
import { Voice } from "./Voice.js"

export interface VoiceHealthStatus {
  stt: boolean
  tts: boolean
}

export interface HeartbeatService {
  start(): Effect.Effect<void>
  stop(): Effect.Effect<void>
  getVoiceHealth(): VoiceHealthStatus
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

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const voice = yield* Voice

    let lastVoiceHealth: VoiceHealthStatus = { stt: false, tts: false }
    const tasks: cron.ScheduledTask[] = []

    return {
      start: () =>
        Effect.gen(function* () {
          yield* Effect.log("Starting heartbeat service...")

          // Check voice health immediately on start
          const initial = yield* voice.isAvailable()
          lastVoiceHealth = initial
          yield* Effect.log(
            `Initial voice health — STT: ${initial.stt}, TTS: ${initial.tts}`
          )

          // Voice health check every 5 minutes
          const voiceHealthTask = cron.schedule("*/5 * * * *", () => {
            Effect.runPromise(
              Effect.gen(function* () {
                const status = yield* voice.isAvailable()
                lastVoiceHealth = status
                broadcast({
                  type: "voice.health",
                  stt: status.stt,
                  tts: status.tts,
                })
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(
                    `Voice health check failed: ${error}`
                  )
                )
              )
            )
          })

          tasks.push(voiceHealthTask)

          yield* Effect.log("Heartbeat service started (voice health every 5m)")
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Effect.log("Stopping heartbeat service...")
          tasks.forEach((task) => task.stop())
          tasks.length = 0
        }),

      getVoiceHealth: () => lastVoiceHealth,
    }
  })
)
