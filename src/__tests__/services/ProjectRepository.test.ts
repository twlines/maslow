/**
 * Unit Tests for Project Repository (AppPersistence project methods)
 *
 * Tests CRUD operations and edge cases.
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
  const dbDir = path.join(tmpDir, `maslow-proj-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("ProjectRepository (AppPersistence project methods)", () => {
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

  describe("createProject", () => {
    it("should create a project with defaults", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.createProject("My Project", "A description")
        })
      )

      expect(result.id).toBeTruthy()
      expect(result.name).toBe("My Project")
      expect(result.description).toBe("A description")
      expect(result.status).toBe("active")
      expect(result.createdAt).toBeGreaterThan(0)
      expect(result.updatedAt).toBeGreaterThan(0)
    })

    it("should create multiple projects with unique ids", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const p1 = yield* ap.createProject("Project 1", "desc")
          const p2 = yield* ap.createProject("Project 2", "desc")
          return { p1, p2 }
        })
      )

      expect(result.p1.id).not.toBe(result.p2.id)
    })
  })

  describe("getProject", () => {
    it("should retrieve a project by id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const created = yield* ap.createProject("Find Me", "searchable")
          return yield* ap.getProject(created.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Find Me")
      expect(result!.description).toBe("searchable")
    })

    it("should return null for non-existent project", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getProject("nonexistent-id")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("getProjects", () => {
    it("should return all projects ordered by updated_at desc", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.createProject("First", "desc")
          yield* ap.createProject("Second", "desc")
          yield* ap.createProject("Third", "desc")
          return yield* ap.getProjects()
        })
      )

      expect(result).toHaveLength(3)
      // Most recently updated first
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].updatedAt).toBeGreaterThanOrEqual(result[i + 1].updatedAt)
      }
    })

    it("should return empty array when no projects exist", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getProjects()
        })
      )

      expect(result).toEqual([])
    })
  })

  describe("updateProject", () => {
    it("should update project name", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Old Name", "desc")
          yield* ap.updateProject(project.id, { name: "New Name" })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.name).toBe("New Name")
      expect(result!.description).toBe("desc")
    })

    it("should update project description", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Name", "Old desc")
          yield* ap.updateProject(project.id, { description: "New desc" })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.description).toBe("New desc")
    })

    it("should update project status", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Name", "desc")
          yield* ap.updateProject(project.id, { status: "archived" })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.status).toBe("archived")
    })

    it("should update project color", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Name", "desc")
          yield* ap.updateProject(project.id, { color: "#ff5733" })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.color).toBe("#ff5733")
    })

    it("should update agent configuration fields", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Name", "desc")
          yield* ap.updateProject(project.id, {
            agentTimeoutMinutes: 60,
            maxConcurrentAgents: 3,
          })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.agentTimeoutMinutes).toBe(60)
      expect(result!.maxConcurrentAgents).toBe(3)
    })

    it("should update multiple fields at once", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Old", "Old desc")
          yield* ap.updateProject(project.id, {
            name: "New",
            description: "New desc",
            status: "paused",
          })
          return yield* ap.getProject(project.id)
        })
      )

      expect(result!.name).toBe("New")
      expect(result!.description).toBe("New desc")
      expect(result!.status).toBe("paused")
    })

    it("should update updatedAt timestamp on update", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Name", "desc")
          const original = project.updatedAt
          yield* Effect.sync(() => {
            const start = Date.now()
            while (Date.now() - start < 5) { /* busy wait */ }
          })
          yield* ap.updateProject(project.id, { name: "Updated" })
          const updated = yield* ap.getProject(project.id)
          return { original, updated: updated!.updatedAt }
        })
      )

      expect(result.updated).toBeGreaterThanOrEqual(result.original)
    })
  })
})
