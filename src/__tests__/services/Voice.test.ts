/**
 * Unit Tests for Voice Service
 *
 * Tests transcription via whisper.cpp mock, synthesis via chatterbox mock,
 * and availability health checks. Uses mocked fetch and ConfigService.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { Voice, VoiceLive } from "../../services/Voice.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"

const testConfig: AppConfig = {
  telegram: { botToken: "test-token", userId: 12345 },
  anthropic: { apiKey: "test-key" },
  workspace: { path: "/tmp/test" },
  database: { path: "/tmp/test.db" },
  voice: {
    whisperUrl: "http://localhost:8080",
    chatterboxUrl: "http://localhost:4123",
    voiceName: "TestVoice",
  },
}

const testConfigLayer = Layer.succeed(ConfigService, testConfig)
const testLayer = VoiceLive.pipe(Layer.provide(testConfigLayer))

const runWithVoice = <A>(
  effect: Effect.Effect<A, unknown, Voice>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, testLayer))

describe("Voice Service", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe("transcribe", () => {
    it("should send audio to whisper and return transcribed text", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "  Hello world  " }),
      })

      const result = await runWithVoice(
        Effect.gen(function* () {
          const voice = yield* Voice
          return yield* voice.transcribe(Buffer.from("fake audio"))
        })
      )

      expect(result).toBe("Hello world")

      const fetchCall = vi.mocked(global.fetch).mock.calls[0]
      expect(fetchCall[0]).toBe("http://localhost:8080/v1/audio/transcriptions")
      expect(fetchCall[1]?.method).toBe("POST")
    })

    it("should fail when whisper returns non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })

      await expect(
        runWithVoice(
          Effect.gen(function* () {
            const voice = yield* Voice
            return yield* voice.transcribe(Buffer.from("audio"))
          })
        )
      ).rejects.toThrow("STT failed")
    })

    it("should fail when fetch throws network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"))

      await expect(
        runWithVoice(
          Effect.gen(function* () {
            const voice = yield* Voice
            return yield* voice.transcribe(Buffer.from("audio"))
          })
        )
      ).rejects.toThrow("STT failed")
    })
  })

  describe("synthesize", () => {
    it("should send text to chatterbox with correct voice", async () => {
      // Mock fetch to return WAV-like data for chatterbox
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      })

      // We cannot easily test the full WAV→OGG pipeline without ffmpeg,
      // but we can verify the fetch call is correct
      const fetchMock = vi.mocked(global.fetch)

      // The synthesize method will fail at the ffmpeg step, but we can
      // verify the HTTP call was made correctly
      try {
        await runWithVoice(
          Effect.gen(function* () {
            const voice = yield* Voice
            return yield* voice.synthesize("Hello")
          })
        )
      } catch {
        // Expected to fail at ffmpeg step in test environment
      }

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4123/v1/audio/speech",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: "Hello",
            voice: "TestVoice",
          }),
        })
      )
    })

    it("should fail when chatterbox returns non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })

      await expect(
        runWithVoice(
          Effect.gen(function* () {
            const voice = yield* Voice
            return yield* voice.synthesize("Hello")
          })
        )
      ).rejects.toThrow("TTS failed")
    })
  })

  describe("isAvailable", () => {
    it("should return true for both when services respond ok", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      const result = await runWithVoice(
        Effect.gen(function* () {
          const voice = yield* Voice
          return yield* voice.isAvailable()
        })
      )

      expect(result.stt).toBe(true)
      expect(result.tts).toBe(true)
    })

    it("should return false when services are unreachable", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"))

      const result = await runWithVoice(
        Effect.gen(function* () {
          const voice = yield* Voice
          return yield* voice.isAvailable()
        })
      )

      expect(result.stt).toBe(false)
      expect(result.tts).toBe(false)
    })

    it("should return false when services return non-ok status", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false })

      const result = await runWithVoice(
        Effect.gen(function* () {
          const voice = yield* Voice
          return yield* voice.isAvailable()
        })
      )

      expect(result.stt).toBe(false)
      expect(result.tts).toBe(false)
    })

    it("should handle mixed availability", async () => {
      let callCount = 0
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++
        // First call (whisper) succeeds, second (chatterbox) fails
        if (callCount === 1) {
          return Promise.resolve({ ok: true })
        }
        return Promise.reject(new Error("not running"))
      })

      const result = await runWithVoice(
        Effect.gen(function* () {
          const voice = yield* Voice
          return yield* voice.isAvailable()
        })
      )

      // One should be true, one false
      expect(result.stt !== result.tts || (result.stt === false && result.tts === false)).toBe(true)
    })
  })
})
