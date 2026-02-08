/**
 * Tests for AppPersistence steering correction operations.
 *
 * Covers: addCorrection, getCorrections (all filter combinations),
 * deactivateCorrection, reactivateCorrection, deleteCorrection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("SteeringRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  describe("addCorrection", () => {
    it("should create a correction with all fields", async () => {
      const correction = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.addCorrection(
            "Use Effect.sync not Effect.tryPromise for SQLite",
            "code-pattern",
            "explicit",
            "Found in Persistence.ts review",
            "proj-1"
          )
        })
      )

      expect(correction.id).toBeTruthy()
      expect(correction.correction).toBe("Use Effect.sync not Effect.tryPromise for SQLite")
      expect(correction.domain).toBe("code-pattern")
      expect(correction.source).toBe("explicit")
      expect(correction.context).toBe("Found in Persistence.ts review")
      expect(correction.projectId).toBe("proj-1")
      expect(correction.active).toBe(true)
      expect(correction.createdAt).toBeTypeOf("number")
    })

    it("should handle optional context and projectId", async () => {
      const correction = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.addCorrection(
            "Prefer interfaces over types",
            "style",
            "pr-rejection"
          )
        })
      )

      expect(correction.context).toBeNull()
      expect(correction.projectId).toBeNull()
    })
  })

  describe("getCorrections", () => {
    it("should return all active corrections by default", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.addCorrection("C1", "code-pattern", "explicit")
          yield* svc.addCorrection("C2", "style", "explicit")
          return yield* svc.getCorrections()
        })
      )

      expect(corrections).toHaveLength(2)
      expect(corrections.every((c) => c.active)).toBe(true)
    })

    it("should filter by domain", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.addCorrection("Code pattern", "code-pattern", "explicit")
          yield* svc.addCorrection("Style rule", "style", "explicit")
          return yield* svc.getCorrections({ domain: "code-pattern" })
        })
      )

      expect(corrections).toHaveLength(1)
      expect(corrections[0].domain).toBe("code-pattern")
    })

    it("should filter by projectId", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.addCorrection("Global", "style", "explicit")
          yield* svc.addCorrection("Project-specific", "style", "explicit", undefined, "proj-1")
          return yield* svc.getCorrections({ projectId: "proj-1" })
        })
      )

      // Should include global corrections (projectId IS NULL) + project-specific
      expect(corrections).toHaveLength(2)
    })

    it("should filter by domain AND projectId", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.addCorrection("Code global", "code-pattern", "explicit")
          yield* svc.addCorrection("Code proj", "code-pattern", "explicit", undefined, "proj-1")
          yield* svc.addCorrection("Style proj", "style", "explicit", undefined, "proj-1")
          return yield* svc.getCorrections({ domain: "code-pattern", projectId: "proj-1" })
        })
      )

      // Should include global code-pattern + project-specific code-pattern
      expect(corrections).toHaveLength(2)
      expect(corrections.every((c) => c.domain === "code-pattern")).toBe(true)
    })

    it("should include inactive corrections when activeOnly is false", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.addCorrection("Deactivated", "style", "explicit")
          yield* svc.deactivateCorrection(c.id)
          yield* svc.addCorrection("Active", "style", "explicit")
          return yield* svc.getCorrections({ activeOnly: false })
        })
      )

      expect(corrections).toHaveLength(2)
      const inactive = corrections.find((c) => !c.active)
      expect(inactive).toBeDefined()
    })

    it("should exclude inactive corrections by default", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.addCorrection("Will deactivate", "style", "explicit")
          yield* svc.deactivateCorrection(c.id)
          yield* svc.addCorrection("Still active", "style", "explicit")
          return yield* svc.getCorrections()
        })
      )

      expect(corrections).toHaveLength(1)
      expect(corrections[0].correction).toBe("Still active")
    })
  })

  describe("deactivateCorrection", () => {
    it("should deactivate a correction", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.addCorrection("Deactivate me", "code-pattern", "explicit")
          yield* svc.deactivateCorrection(c.id)
          return yield* svc.getCorrections({ activeOnly: false })
        })
      )

      expect(corrections[0].active).toBe(false)
    })
  })

  describe("reactivateCorrection", () => {
    it("should reactivate a deactivated correction", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.addCorrection("Toggle me", "style", "explicit")
          yield* svc.deactivateCorrection(c.id)
          yield* svc.reactivateCorrection(c.id)
          return yield* svc.getCorrections()
        })
      )

      expect(corrections).toHaveLength(1)
      expect(corrections[0].active).toBe(true)
    })
  })

  describe("deleteCorrection", () => {
    it("should permanently delete a correction", async () => {
      const corrections = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.addCorrection("Delete me", "architecture", "edit-delta")
          yield* svc.deleteCorrection(c.id)
          return yield* svc.getCorrections({ activeOnly: false })
        })
      )

      expect(corrections).toHaveLength(0)
    })

    it("should not error when deleting non-existent correction", async () => {
      await expect(
        run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            yield* svc.deleteCorrection("nonexistent")
          })
        )
      ).resolves.not.toThrow()
    })
  })
})
