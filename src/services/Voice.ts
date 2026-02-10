/**
 * Voice Service
 *
 * DESIGN INTENT: Wraps local Whisper and Chatterbox HTTP services into a unified voice I/O interface.
 *
 * Handles speech-to-text (whisper.cpp) and text-to-speech (Chatterbox)
 * via local HTTP services.
 */

// ─── External Imports ───────────────────────────────────────────────

import { Context, Effect, Layer } from "effect";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ─── Internal Imports ───────────────────────────────────────────────

import { ConfigService } from "./Config.js";

// ─── Constants ──────────────────────────────────────────────────────

const LOG_PREFIX = "[Voice]"

// ─── Types ──────────────────────────────────────────────────────────

export interface VoiceService {
  /**
   * Transcribe audio to text via whisper.cpp server
   */
  transcribe(audioBuffer: Buffer): Effect.Effect<string, Error>;

  /**
   * Synthesize text to audio via Chatterbox server
   * Returns OGG/Opus audio buffer ready for Telegram voice notes
   */
  synthesize(text: string): Effect.Effect<Buffer, Error>;

  /**
   * Check if voice services are available
   */
  isAvailable(): Effect.Effect<{ stt: boolean; tts: boolean }, never>;
}

// ─── Service Tag ────────────────────────────────────────────────────

export class Voice extends Context.Tag("Voice")<Voice, VoiceService>() {}

// ─── Implementation ─────────────────────────────────────────────────

export const VoiceLive = Layer.effect(
  Voice,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const whisperUrl = config.voice?.whisperUrl ?? "http://localhost:8080";
    const chatterboxUrl =
      config.voice?.chatterboxUrl ?? "http://localhost:4123";
    const voiceName = config.voice?.voiceName ?? "Michael";

    return {
      transcribe: (audioBuffer: Buffer) =>
        Effect.tryPromise({
          try: async () => {
            // whisper.cpp server expects multipart form data
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: "audio/ogg" });
            formData.append("file", blob, "audio.ogg");
            formData.append("response_format", "json");

            const response = await fetch(
              `${whisperUrl}/v1/audio/transcriptions`,
              {
                method: "POST",
                body: formData,
              }
            );

            if (!response.ok) {
              throw new Error(
                `Whisper transcription failed: ${response.status} ${response.statusText}`
              );
            }

            const result = (await response.json()) as { text: string };
            return result.text.trim();
          },
          catch: (error) =>
            new Error(
              `STT failed: ${error instanceof Error ? error.message : error}`
            ),
        }),

      synthesize: (text: string) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${chatterboxUrl}/v1/audio/speech`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input: text,
                voice: voiceName,
              }),
            });

            if (!response.ok) {
              throw new Error(
                `Chatterbox synthesis failed: ${response.status} ${response.statusText}`
              );
            }

            const wavBuffer = Buffer.from(await response.arrayBuffer());

            // Convert WAV to OGG/Opus for Telegram voice notes
            const id = Date.now();
            const wavPath = join(tmpdir(), `maslow-tts-${id}.wav`);
            const oggPath = join(tmpdir(), `maslow-tts-${id}.ogg`);

            await writeFile(wavPath, wavBuffer);

            await new Promise<void>((resolve, reject) => {
              execFile(
                "ffmpeg",
                ["-i", wavPath, "-c:a", "libopus", "-y", oggPath],
                (error) => (error ? reject(error) : resolve())
              );
            });

            const oggBuffer = await readFile(oggPath);

            // Cleanup temp files
            await unlink(wavPath).catch(() => {});
            await unlink(oggPath).catch(() => {});

            return oggBuffer;
          },
          catch: (error) =>
            new Error(
              `TTS failed: ${error instanceof Error ? error.message : error}`
            ),
        }),

      isAvailable: () =>
        Effect.gen(function* () {
          const checkService = (url: string) =>
            Effect.tryPromise({
              try: async () => {
                const res = await fetch(url, {
                  method: "GET",
                  signal: AbortSignal.timeout(2000),
                });
                return res.ok;
              },
              catch: () => false,
            }).pipe(Effect.catchAll(() => Effect.succeed(false)));

          const stt = yield* checkService(whisperUrl);
          const tts = yield* checkService(chatterboxUrl);
          return { stt, tts };
        }),
    };
  })
);
