/**
 * Tests for AppPersistence FTS5 search indexing.
 *
 * Verifies that FTS5 virtual tables are properly populated
 * via triggers when kanban cards, project documents, and decisions
 * are created, updated, and deleted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import Database from "better-sqlite3"
import * as path from "path"
import { AppPersistence, AppPersistenceLive } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  createTestConfigLayer,
} from "./test-helpers.js"

describe("SearchRepository (FTS5)", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  // Helper that runs the effect AND returns the raw DB path for FTS queries
  const runThenQueryFts = async <A>(
    effectFn: Effect.Effect<A, unknown, AppPersistence>
  ): Promise<{ result: A; dbPath: string }> => {
    const configLayer = createTestConfigLayer(tempDir)
    const testLayer = AppPersistenceLive.pipe(Layer.provide(configLayer))

    const result = await Effect.runPromise(
      Effect.scoped(Effect.provide(effectFn, testLayer))
    )

    return { result, dbPath: path.join(tempDir, "app.db") }
  }

  // Helper to query FTS and return match count
  const queryFts = (dbPath: string, table: string, query: string): unknown[] => {
    const db = new Database(dbPath, { readonly: true })
    try {
      return db.prepare(`SELECT * FROM ${table} WHERE ${table} MATCH ?`).all(query)
    } finally {
      db.close()
    }
  }

  const setupProject = Effect.gen(function* () {
    const svc = yield* AppPersistence
    const project = yield* svc.createProject("Search Test", "For FTS testing")
    return { svc, projectId: project.id }
  })

  describe("kanban_cards_fts", () => {
    it("should index card title and description on insert", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createCard(projectId, "Authentication Flow", "Implement OAuth2 login")
        })
      )

      const results = queryFts(dbPath, "kanban_cards_fts", "Authentication")
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it("should update FTS index when card is updated", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Old Title", "Old description")
          yield* svc.updateCard(card.id, { title: "Refactored Architecture", description: "New approach" })
        })
      )

      const oldResults = queryFts(dbPath, "kanban_cards_fts", "Old")
      const newResults = queryFts(dbPath, "kanban_cards_fts", "Refactored")

      expect(oldResults).toHaveLength(0)
      expect(newResults.length).toBeGreaterThanOrEqual(1)
    })

    it("should remove from FTS index when card is deleted", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Temporary Card", "Remove me")
          yield* svc.deleteCard(card.id)
        })
      )

      const results = queryFts(dbPath, "kanban_cards_fts", "Temporary")
      expect(results).toHaveLength(0)
    })

    it("should find cards by description text", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createCard(projectId, "Card 1", "Implement caching layer with Redis")
          yield* svc.createCard(projectId, "Card 2", "Add unit tests for auth")
        })
      )

      const results = queryFts(dbPath, "kanban_cards_fts", "Redis")
      expect(results.length).toBe(1)
    })
  })

  describe("project_documents_fts", () => {
    it("should index document title and content on insert", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createProjectDocument(
            projectId,
            "brief",
            "Project Brief",
            "Build a microservices architecture with GraphQL gateway"
          )
        })
      )

      const results = queryFts(dbPath, "project_documents_fts", "microservices")
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it("should update FTS index when document is updated", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const doc = yield* svc.createProjectDocument(
            projectId,
            "reference",
            "API Docs",
            "REST endpoints"
          )
          yield* svc.updateProjectDocument(doc.id, { content: "GraphQL schema definitions" })
        })
      )

      const restResults = queryFts(dbPath, "project_documents_fts", "REST")
      const gqlResults = queryFts(dbPath, "project_documents_fts", "GraphQL")

      expect(restResults).toHaveLength(0)
      expect(gqlResults.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("decisions_fts", () => {
    it("should index decision title, description, and reasoning on insert", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createDecision(
            projectId,
            "Database Choice",
            "Choosing between PostgreSQL and SQLite",
            ["PostgreSQL", "SQLite", "MySQL"],
            "SQLite chosen for simplicity and zero ops",
            "Less scalable but simpler deployment"
          )
        })
      )

      const titleResults = queryFts(dbPath, "decisions_fts", "Database")
      expect(titleResults.length).toBeGreaterThanOrEqual(1)
    })

    it("should search across reasoning text", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createDecision(
            projectId,
            "Auth Strategy",
            "Authentication approach",
            ["JWT", "Session based"],
            "JWT chosen for stateless scalability across microservices",
            "Token management overhead"
          )
        })
      )

      const results = queryFts(dbPath, "decisions_fts", "stateless")
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it("should update FTS index when decision is updated", async () => {
      const { dbPath } = await runThenQueryFts(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const decision = yield* svc.createDecision(
            projectId,
            "Initial Decision",
            "Some description",
            [],
            "Initial reasoning",
            ""
          )
          yield* svc.updateDecision(decision.id, {
            title: "Revised Decision",
            description: "New description",
            reasoning: "Updated reasoning with Kubernetes",
          })
        })
      )

      // "Initial" was fully replaced across all fields
      const oldResults = queryFts(dbPath, "decisions_fts", "Initial")
      const newResults = queryFts(dbPath, "decisions_fts", "Kubernetes")

      expect(oldResults).toHaveLength(0)
      expect(newResults.length).toBeGreaterThanOrEqual(1)
    })
  })
})
