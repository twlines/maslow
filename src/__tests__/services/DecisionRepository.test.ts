/**
 * Unit Tests for Decision Repository (AppPersistence decision methods)
 *
 * Tests CRUD operations, JSON array round-trip, and edge cases.
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
  const dbDir = path.join(tmpDir, `maslow-dec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("DecisionRepository (AppPersistence decision methods)", () => {
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

  describe("createDecision", () => {
    it("should create a decision with all fields", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.createDecision(
            project.id,
            "Use Effect-TS",
            "Choose a framework for service layer",
            ["Effect-TS", "fp-ts", "vanilla TypeScript"],
            "Effect-TS provides better error handling and composability",
            "More complex learning curve but better long-term maintainability"
          )
        })
      )

      expect(result.id).toBeTruthy()
      expect(result.title).toBe("Use Effect-TS")
      expect(result.description).toBe("Choose a framework for service layer")
      expect(result.alternatives).toEqual(["Effect-TS", "fp-ts", "vanilla TypeScript"])
      expect(result.reasoning).toBe("Effect-TS provides better error handling and composability")
      expect(result.tradeoffs).toBe("More complex learning curve but better long-term maintainability")
      expect(result.createdAt).toBeGreaterThan(0)
    })

    it("should handle empty alternatives array", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.createDecision(project.id, "Title", "desc", [], "reason", "tradeoffs")
        })
      )

      expect(result.alternatives).toEqual([])
    })
  })

  describe("getDecision", () => {
    it("should retrieve a decision by id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const created = yield* ap.createDecision(project.id, "Decision", "desc", ["A", "B"], "reason", "tradeoffs")
          return yield* ap.getDecision(created.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Decision")
      expect(result!.alternatives).toEqual(["A", "B"])
    })

    it("should return null for non-existent decision", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getDecision("nonexistent-id")
        })
      )

      expect(result).toBeNull()
    })

    it("should correctly round-trip JSON alternatives array", async () => {
      const alternatives = [
        "Option with special chars: <>&\"'",
        "Unicode option: 日本語",
        "Long option: " + "x".repeat(500),
      ]
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const created = yield* ap.createDecision(project.id, "Decision", "desc", alternatives, "reason", "tradeoffs")
          return yield* ap.getDecision(created.id)
        })
      )

      expect(result!.alternatives).toEqual(alternatives)
    })
  })

  describe("getDecisions", () => {
    it("should return all decisions for a project", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createDecision(project.id, "Decision 1", "desc", ["A"], "r", "t")
          yield* ap.createDecision(project.id, "Decision 2", "desc", ["B"], "r", "t")
          yield* ap.createDecision(project.id, "Decision 3", "desc", ["C"], "r", "t")
          return yield* ap.getDecisions(project.id)
        })
      )

      expect(result).toHaveLength(3)
    })

    it("should return empty array for project with no decisions", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.getDecisions(project.id)
        })
      )

      expect(result).toEqual([])
    })

    it("should isolate decisions between projects", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const p1 = yield* ap.createProject("P1", "desc")
          const p2 = yield* ap.createProject("P2", "desc")
          yield* ap.createDecision(p1.id, "P1 Decision", "desc", [], "r", "t")
          yield* ap.createDecision(p2.id, "P2 Decision A", "desc", [], "r", "t")
          yield* ap.createDecision(p2.id, "P2 Decision B", "desc", [], "r", "t")
          const p1Decisions = yield* ap.getDecisions(p1.id)
          const p2Decisions = yield* ap.getDecisions(p2.id)
          return { p1Decisions, p2Decisions }
        })
      )

      expect(result.p1Decisions).toHaveLength(1)
      expect(result.p2Decisions).toHaveLength(2)
    })

    it("should order by created_at descending", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createDecision(project.id, "First", "desc", [], "r", "t")
          yield* ap.createDecision(project.id, "Second", "desc", [], "r", "t")
          yield* ap.createDecision(project.id, "Third", "desc", [], "r", "t")
          return yield* ap.getDecisions(project.id)
        })
      )

      // Most recent first
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].createdAt).toBeGreaterThanOrEqual(result[i + 1].createdAt)
      }
    })
  })

  describe("updateDecision", () => {
    it("should update decision title", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const decision = yield* ap.createDecision(project.id, "Old Title", "desc", [], "r", "t")
          yield* ap.updateDecision(decision.id, { title: "New Title" })
          return yield* ap.getDecision(decision.id)
        })
      )

      expect(result!.title).toBe("New Title")
    })

    it("should update decision alternatives", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const decision = yield* ap.createDecision(project.id, "Title", "desc", ["A"], "r", "t")
          yield* ap.updateDecision(decision.id, { alternatives: ["A", "B", "C"] })
          return yield* ap.getDecision(decision.id)
        })
      )

      expect(result!.alternatives).toEqual(["A", "B", "C"])
    })

    it("should set revisedAt on update", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const decision = yield* ap.createDecision(project.id, "Title", "desc", [], "r", "t")
          expect(decision.revisedAt).toBeUndefined()
          yield* ap.updateDecision(decision.id, { reasoning: "Updated reasoning" })
          return yield* ap.getDecision(decision.id)
        })
      )

      expect(result!.revisedAt).toBeDefined()
      expect(result!.revisedAt).toBeGreaterThan(0)
    })

    it("should update multiple fields at once", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const decision = yield* ap.createDecision(project.id, "Title", "desc", ["A"], "old reason", "old tradeoffs")
          yield* ap.updateDecision(decision.id, {
            title: "Updated Title",
            description: "Updated desc",
            reasoning: "New reasoning",
            tradeoffs: "New tradeoffs",
          })
          return yield* ap.getDecision(decision.id)
        })
      )

      expect(result!.title).toBe("Updated Title")
      expect(result!.description).toBe("Updated desc")
      expect(result!.reasoning).toBe("New reasoning")
      expect(result!.tradeoffs).toBe("New tradeoffs")
    })
  })
})
