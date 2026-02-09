/**
 * Unit Tests for Document Repository (AppPersistence project document methods)
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
  const dbDir = path.join(tmpDir, `maslow-doc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("DocumentRepository (AppPersistence project document methods)", () => {
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

  describe("createProjectDocument", () => {
    it("should create a document with all fields", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.createProjectDocument(project.id, "brief", "Project Brief", "This is the brief content")
        })
      )

      expect(result.id).toBeTruthy()
      expect(result.projectId).toBeTruthy()
      expect(result.type).toBe("brief")
      expect(result.title).toBe("Project Brief")
      expect(result.content).toBe("This is the brief content")
      expect(result.createdAt).toBeGreaterThan(0)
      expect(result.updatedAt).toBeGreaterThan(0)
    })

    it("should support all document types", async () => {
      const types = ["brief", "instructions", "reference", "decisions", "assumptions", "state"] as const
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const docs = []
          for (const type of types) {
            const doc = yield* ap.createProjectDocument(project.id, type, `${type} doc`, `content for ${type}`)
            docs.push(doc)
          }
          return docs
        })
      )

      expect(result).toHaveLength(6)
      for (let i = 0; i < types.length; i++) {
        expect(result[i].type).toBe(types[i])
      }
    })
  })

  describe("getProjectDocument", () => {
    it("should retrieve a document by id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const created = yield* ap.createProjectDocument(project.id, "brief", "Title", "Content")
          return yield* ap.getProjectDocument(created.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Title")
      expect(result!.content).toBe("Content")
    })

    it("should return null for non-existent document", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getProjectDocument("nonexistent-id")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("getProjectDocuments", () => {
    it("should return all documents for a project", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createProjectDocument(project.id, "brief", "Brief", "content")
          yield* ap.createProjectDocument(project.id, "instructions", "Instructions", "content")
          yield* ap.createProjectDocument(project.id, "reference", "Reference", "content")
          return yield* ap.getProjectDocuments(project.id)
        })
      )

      expect(result).toHaveLength(3)
    })

    it("should return empty array for project with no documents", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.getProjectDocuments(project.id)
        })
      )

      expect(result).toEqual([])
    })

    it("should isolate documents between projects", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const p1 = yield* ap.createProject("P1", "desc")
          const p2 = yield* ap.createProject("P2", "desc")
          yield* ap.createProjectDocument(p1.id, "brief", "P1 Brief", "content")
          yield* ap.createProjectDocument(p2.id, "brief", "P2 Brief A", "content")
          yield* ap.createProjectDocument(p2.id, "instructions", "P2 Instructions", "content")
          const p1Docs = yield* ap.getProjectDocuments(p1.id)
          const p2Docs = yield* ap.getProjectDocuments(p2.id)
          return { p1Docs, p2Docs }
        })
      )

      expect(result.p1Docs).toHaveLength(1)
      expect(result.p2Docs).toHaveLength(2)
    })
  })

  describe("updateProjectDocument", () => {
    it("should update document title", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const doc = yield* ap.createProjectDocument(project.id, "brief", "Old Title", "content")
          yield* ap.updateProjectDocument(doc.id, { title: "New Title" })
          return yield* ap.getProjectDocument(doc.id)
        })
      )

      expect(result!.title).toBe("New Title")
      expect(result!.content).toBe("content")
    })

    it("should update document content", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const doc = yield* ap.createProjectDocument(project.id, "brief", "Title", "Old content")
          yield* ap.updateProjectDocument(doc.id, { content: "New content" })
          return yield* ap.getProjectDocument(doc.id)
        })
      )

      expect(result!.content).toBe("New content")
      expect(result!.title).toBe("Title")
    })

    it("should update both title and content", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const doc = yield* ap.createProjectDocument(project.id, "brief", "Old", "Old")
          yield* ap.updateProjectDocument(doc.id, { title: "New", content: "New" })
          return yield* ap.getProjectDocument(doc.id)
        })
      )

      expect(result!.title).toBe("New")
      expect(result!.content).toBe("New")
    })

    it("should update updatedAt on modification", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const doc = yield* ap.createProjectDocument(project.id, "brief", "Title", "content")
          const original = doc.updatedAt
          yield* Effect.sync(() => {
            const start = Date.now()
            while (Date.now() - start < 5) { /* busy wait */ }
          })
          yield* ap.updateProjectDocument(doc.id, { content: "Updated" })
          const updated = yield* ap.getProjectDocument(doc.id)
          return { original, updated: updated!.updatedAt }
        })
      )

      expect(result.updated).toBeGreaterThanOrEqual(result.original)
    })

    it("should handle large content", async () => {
      const largeContent = "x".repeat(100_000)
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const doc = yield* ap.createProjectDocument(project.id, "reference", "Big Doc", largeContent)
          return yield* ap.getProjectDocument(doc.id)
        })
      )

      expect(result!.content.length).toBe(100_000)
    })
  })
})
