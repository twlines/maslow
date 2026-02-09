/**
 * Unit Tests for Steering Repository (AppPersistence steering correction methods)
 *
 * Tests CRUD operations, filtering, activation/deactivation, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import {
  AppPersistence,
  AppPersistenceLive,
} from "../../services/AppPersistence.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

const createTestConfigLayer = (dbDir: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: path.join(dbDir, "sessions.db") },
  } satisfies AppConfig)

const createTempDbDir = () => {
  const tmpDir = os.tmpdir()
  const dbDir = path.join(tmpDir, `maslow-steer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dbDir, { recursive: true })
  return dbDir
}

const cleanupTempDir = (dir: string) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

describe("SteeringRepository (AppPersistence steering correction methods)", () => {
  let tempDbDir: string

  beforeEach(() => {
    tempDbDir = createTempDbDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDbDir)
  })

  const runWithAppPersistence = <A>(
    effect: Effect.Effect<A, unknown, AppPersistence>
  ): Promise<A> => {
    const testConfigLayer = createTestConfigLayer(tempDbDir)
    const testLayer = AppPersistenceLive.pipe(Layer.provide(testConfigLayer))
    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer))
    )
  }

  describe("addCorrection", () => {
    it("should add a correction with all fields", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.addCorrection(
            "Use double quotes for strings",
            "code-pattern",
            "explicit",
            "Reviewed in code review",
            "project-123"
          )
        })
      )

      expect(result.id).toBeTruthy()
      expect(result.correction).toBe("Use double quotes for strings")
      expect(result.domain).toBe("code-pattern")
      expect(result.source).toBe("explicit")
      expect(result.context).toBe("Reviewed in code review")
      expect(result.projectId).toBe("project-123")
      expect(result.active).toBe(true)
      expect(result.createdAt).toBeGreaterThan(0)
    })

    it("should add a correction without optional fields", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.addCorrection(
            "Prefer interfaces over type aliases",
            "architecture",
            "pr-rejection"
          )
        })
      )

      expect(result.context).toBeNull()
      expect(result.projectId).toBeNull()
      expect(result.active).toBe(true)
    })

    it("should support all domain types", async () => {
      const domains = ["code-pattern", "communication", "architecture", "preference", "style", "process"] as const
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const corrections = []
          for (const domain of domains) {
            const c = yield* ap.addCorrection(`Correction for ${domain}`, domain, "explicit")
            corrections.push(c)
          }
          return corrections
        })
      )

      expect(result).toHaveLength(6)
      for (let i = 0; i < domains.length; i++) {
        expect(result[i].domain).toBe(domains[i])
      }
    })

    it("should support all source types", async () => {
      const sources = ["explicit", "pr-rejection", "edit-delta", "agent-feedback"] as const
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const corrections = []
          for (const source of sources) {
            const c = yield* ap.addCorrection(`Correction from ${source}`, "style", source)
            corrections.push(c)
          }
          return corrections
        })
      )

      expect(result).toHaveLength(4)
      for (let i = 0; i < sources.length; i++) {
        expect(result[i].source).toBe(sources[i])
      }
    })
  })

  describe("getCorrections", () => {
    it("should return all active corrections by default", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("C1", "code-pattern", "explicit")
          yield* ap.addCorrection("C2", "architecture", "explicit")
          yield* ap.addCorrection("C3", "style", "explicit")
          return yield* ap.getCorrections()
        })
      )

      expect(result).toHaveLength(3)
      expect(result.every((c) => c.active)).toBe(true)
    })

    it("should filter by domain", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("C1", "code-pattern", "explicit")
          yield* ap.addCorrection("C2", "architecture", "explicit")
          yield* ap.addCorrection("C3", "code-pattern", "explicit")
          return yield* ap.getCorrections({ domain: "code-pattern" })
        })
      )

      expect(result).toHaveLength(2)
      expect(result.every((c) => c.domain === "code-pattern")).toBe(true)
    })

    it("should filter by projectId", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("Global", "style", "explicit")
          yield* ap.addCorrection("Project specific", "style", "explicit", undefined, "project-1")
          yield* ap.addCorrection("Other project", "style", "explicit", undefined, "project-2")
          return yield* ap.getCorrections({ projectId: "project-1" })
        })
      )

      // Should include project-specific AND global (null projectId) corrections
      expect(result).toHaveLength(2)
    })

    it("should filter by both domain and projectId", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("Match", "code-pattern", "explicit", undefined, "project-1")
          yield* ap.addCorrection("Wrong domain", "style", "explicit", undefined, "project-1")
          yield* ap.addCorrection("Wrong project", "code-pattern", "explicit", undefined, "project-2")
          yield* ap.addCorrection("Global match", "code-pattern", "explicit")
          return yield* ap.getCorrections({ domain: "code-pattern", projectId: "project-1" })
        })
      )

      // Should include project-1 code-pattern AND global code-pattern corrections
      expect(result).toHaveLength(2)
    })

    it("should include inactive when activeOnly is false", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("Active", "style", "explicit")
          const c2 = yield* ap.addCorrection("Will deactivate", "style", "explicit")
          yield* ap.deactivateCorrection(c2.id)
          return yield* ap.getCorrections({ activeOnly: false })
        })
      )

      expect(result).toHaveLength(2)
      const active = result.filter((c) => c.active)
      const inactive = result.filter((c) => !c.active)
      expect(active).toHaveLength(1)
      expect(inactive).toHaveLength(1)
    })

    it("should exclude inactive by default", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.addCorrection("Active", "style", "explicit")
          const c2 = yield* ap.addCorrection("Inactive", "style", "explicit")
          yield* ap.deactivateCorrection(c2.id)
          return yield* ap.getCorrections()
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0].correction).toBe("Active")
    })
  })

  describe("deactivateCorrection", () => {
    it("should deactivate a correction", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const c = yield* ap.addCorrection("To deactivate", "style", "explicit")
          yield* ap.deactivateCorrection(c.id)
          return yield* ap.getCorrections({ activeOnly: false })
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0].active).toBe(false)
    })
  })

  describe("reactivateCorrection", () => {
    it("should reactivate a deactivated correction", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const c = yield* ap.addCorrection("Toggle me", "style", "explicit")
          yield* ap.deactivateCorrection(c.id)
          yield* ap.reactivateCorrection(c.id)
          return yield* ap.getCorrections()
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0].active).toBe(true)
    })
  })

  describe("deleteCorrection", () => {
    it("should permanently delete a correction", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const c = yield* ap.addCorrection("To delete", "style", "explicit")
          yield* ap.deleteCorrection(c.id)
          return yield* ap.getCorrections({ activeOnly: false })
        })
      )

      expect(result).toEqual([])
    })

    it("should not error when deleting non-existent correction", async () => {
      await expect(
        runWithAppPersistence(
          Effect.gen(function* () {
            const ap = yield* AppPersistence
            yield* ap.deleteCorrection("nonexistent-id")
          })
        )
      ).resolves.not.toThrow()
    })
  })

  describe("correction lifecycle", () => {
    it("should support add → query → deactivate → reactivate → delete flow", async () => {
      await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence

          // Add corrections
          const c1 = yield* ap.addCorrection("Use no semicolons", "code-pattern", "explicit", "Style guide")
          yield* ap.addCorrection("Prefer Effect.gen", "architecture", "pr-rejection", "PR #42")

          // Query all
          const all = yield* ap.getCorrections()
          expect(all).toHaveLength(2)

          // Filter by domain
          const codePatterns = yield* ap.getCorrections({ domain: "code-pattern" })
          expect(codePatterns).toHaveLength(1)
          expect(codePatterns[0].correction).toBe("Use no semicolons")

          // Deactivate
          yield* ap.deactivateCorrection(c1.id)
          const afterDeactivate = yield* ap.getCorrections()
          expect(afterDeactivate).toHaveLength(1)

          // Reactivate
          yield* ap.reactivateCorrection(c1.id)
          const afterReactivate = yield* ap.getCorrections()
          expect(afterReactivate).toHaveLength(2)

          // Delete
          yield* ap.deleteCorrection(c1.id)
          const afterDelete = yield* ap.getCorrections()
          expect(afterDelete).toHaveLength(1)
          expect(afterDelete[0].correction).toBe("Prefer Effect.gen")
        })
      )
    })
  })
})
