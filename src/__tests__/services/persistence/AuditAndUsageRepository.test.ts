/**
 * Tests for AppPersistence audit log, token usage, and usage summary operations.
 *
 * Covers: logAudit, insertTokenUsage, getUsageSummary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("AuditAndUsageRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  describe("logAudit", () => {
    it("should log an audit entry with all fields", async () => {
      await expect(
        run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            yield* svc.logAudit(
              "kanban_card",
              "card-1",
              "created",
              { title: "New card" },
              "user"
            )
          })
        )
      ).resolves.not.toThrow()
    })

    it("should use defaults for optional fields", async () => {
      await expect(
        run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            yield* svc.logAudit("project", "proj-1", "updated")
          })
        )
      ).resolves.not.toThrow()
    })
  })

  describe("insertTokenUsage", () => {
    it("should insert and return token usage with generated id", async () => {
      const usage = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.createProject("token-project", "Test")
          return yield* svc.insertTokenUsage({
            cardId: "card-1",
            projectId: "token-project",
            agent: "claude",
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
            costUsd: 0.05,
            createdAt: Date.now(),
          })
        })
      )

      expect(usage.id).toBeTruthy()
      expect(usage.agent).toBe("claude")
      expect(usage.inputTokens).toBe(1000)
      expect(usage.outputTokens).toBe(500)
      expect(usage.cacheReadTokens).toBe(200)
      expect(usage.cacheWriteTokens).toBe(100)
      expect(usage.costUsd).toBe(0.05)
    })

    it("should handle null cardId", async () => {
      const usage = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.insertTokenUsage({
            cardId: null,
            projectId: "proj-1",
            agent: "codex",
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.01,
            createdAt: Date.now(),
          })
        })
      )

      expect(usage.cardId).toBeNull()
    })
  })

  describe("getUsageSummary", () => {
    it("should return empty summary when no usage data exists", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.total.inputTokens).toBe(0)
      expect(summary.total.outputTokens).toBe(0)
      expect(summary.total.costUsd).toBe(0)
      expect(summary.byProject).toEqual([])
      expect(summary.recentMessages).toEqual([])
    })

    it("should aggregate usage from assistant messages with metadata", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const project = yield* svc.createProject("Usage Project", "")

          // Save assistant messages with token metadata
          yield* svc.saveMessage({
            id: "msg-1",
            projectId: project.id,
            role: "assistant",
            content: "Response 1",
            timestamp: Date.now(),
            metadata: { tokens: { input: 100, output: 50 }, cost: 0.01 },
          })
          yield* svc.saveMessage({
            id: "msg-2",
            projectId: project.id,
            role: "assistant",
            content: "Response 2",
            timestamp: Date.now(),
            metadata: { tokens: { input: 200, output: 100 }, cost: 0.02 },
          })

          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.total.inputTokens).toBe(300)
      expect(summary.total.outputTokens).toBe(150)
      expect(summary.total.costUsd).toBeCloseTo(0.03)
      expect(summary.byProject).toHaveLength(1)
      expect(summary.recentMessages).toHaveLength(2)
    })

    it("should filter by projectId", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const p1 = yield* svc.createProject("Project 1", "")
          const p2 = yield* svc.createProject("Project 2", "")

          yield* svc.saveMessage({
            id: "p1-msg",
            projectId: p1.id,
            role: "assistant",
            content: "P1 response",
            timestamp: Date.now(),
            metadata: { tokens: { input: 100, output: 50 }, cost: 0.01 },
          })
          yield* svc.saveMessage({
            id: "p2-msg",
            projectId: p2.id,
            role: "assistant",
            content: "P2 response",
            timestamp: Date.now(),
            metadata: { tokens: { input: 200, output: 100 }, cost: 0.02 },
          })

          return yield* svc.getUsageSummary(p1.id)
        })
      )

      expect(summary.total.inputTokens).toBe(100)
      expect(summary.total.costUsd).toBeCloseTo(0.01)
    })

    it("should respect days parameter for time window", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const project = yield* svc.createProject("Time Project", "")

          // Save a message from 60 days ago (outside default 30-day window)
          yield* svc.saveMessage({
            id: "old-msg",
            projectId: project.id,
            role: "assistant",
            content: "Old response",
            timestamp: Date.now() - 60 * 24 * 60 * 60 * 1000,
            metadata: { tokens: { input: 1000, output: 500 }, cost: 0.1 },
          })

          // Save a recent message
          yield* svc.saveMessage({
            id: "new-msg",
            projectId: project.id,
            role: "assistant",
            content: "New response",
            timestamp: Date.now(),
            metadata: { tokens: { input: 100, output: 50 }, cost: 0.01 },
          })

          return yield* svc.getUsageSummary(undefined, 30)
        })
      )

      // Only the recent message should be counted
      expect(summary.total.inputTokens).toBe(100)
      expect(summary.recentMessages).toHaveLength(1)
    })

    it("should ignore user messages", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "user-msg",
            projectId: null,
            role: "user",
            content: "User input",
            timestamp: Date.now(),
            metadata: { tokens: { input: 500, output: 0 }, cost: 0 },
          })
          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.total.inputTokens).toBe(0)
    })

    it("should ignore messages without metadata", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "no-meta",
            projectId: null,
            role: "assistant",
            content: "No metadata",
            timestamp: Date.now(),
          })
          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.total.inputTokens).toBe(0)
    })

    it("should sort byProject by totalCost descending", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const cheap = yield* svc.createProject("Cheap Project", "")
          const expensive = yield* svc.createProject("Expensive Project", "")

          yield* svc.saveMessage({
            id: "cheap-msg",
            projectId: cheap.id,
            role: "assistant",
            content: "Cheap",
            timestamp: Date.now(),
            metadata: { tokens: { input: 10, output: 5 }, cost: 0.001 },
          })
          yield* svc.saveMessage({
            id: "expensive-msg",
            projectId: expensive.id,
            role: "assistant",
            content: "Expensive",
            timestamp: Date.now(),
            metadata: { tokens: { input: 1000, output: 500 }, cost: 0.1 },
          })

          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.byProject).toHaveLength(2)
      expect(summary.byProject[0].projectName).toBe("Expensive Project")
      expect(summary.byProject[1].projectName).toBe("Cheap Project")
    })

    it("should limit recentMessages to 20", async () => {
      const summary = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          for (let i = 0; i < 25; i++) {
            yield* svc.saveMessage({
              id: `bulk-${i}`,
              projectId: null,
              role: "assistant",
              content: `Response ${i}`,
              timestamp: Date.now() + i,
              metadata: { tokens: { input: 10, output: 5 }, cost: 0.001 },
            })
          }
          return yield* svc.getUsageSummary()
        })
      )

      expect(summary.recentMessages).toHaveLength(20)
    })
  })
})
