/**
 * Shared test helpers for AppPersistence tests.
 * Creates a temporary directory with a real AppPersistence layer
 * using file-backed SQLite for each test suite.
 */

import { Effect, Layer } from "effect"
import { AppPersistence, AppPersistenceLive } from "../../../services/AppPersistence.js"
import { ConfigService, type AppConfig } from "../../../services/Config.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

export const createTempDir = (): string => {
  const dir = path.join(
    os.tmpdir(),
    `maslow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const cleanupTempDir = (dir: string): void => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

export const createTestConfigLayer = (tempDir: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: path.join(tempDir, "sessions.db") },
  } satisfies AppConfig)

export const createTestLayer = (tempDir: string) =>
  AppPersistenceLive.pipe(Layer.provide(createTestConfigLayer(tempDir)))

export const runWithAppPersistence = <A>(
  effect: Effect.Effect<A, unknown, AppPersistence>,
  tempDir: string
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(effect, createTestLayer(tempDir)))
  )
