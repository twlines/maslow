/**
 * Tests for AppPersistence conversation operations.
 *
 * Covers: createConversation, getActiveConversation, updateConversationSession,
 * updateConversationContext, archiveConversation, getRecentConversations,
 * incrementMessageCount.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("ConversationRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  describe("createConversation", () => {
    it("should create an active conversation", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.createConversation("proj-1")
        })
      )

      expect(conv.id).toBeTruthy()
      expect(conv.projectId).toBe("proj-1")
      expect(conv.status).toBe("active")
      expect(conv.claudeSessionId).toBe("")
      expect(conv.contextUsagePercent).toBe(0)
      expect(conv.messageCount).toBe(0)
      expect(conv.summary).toBeNull()
    })

    it("should create a conversation with null projectId", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.createConversation(null)
        })
      )

      expect(conv.projectId).toBeNull()
    })
  })

  describe("getActiveConversation", () => {
    it("should return the most recent active conversation for a project", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.createConversation("proj-1")
          return yield* svc.getActiveConversation("proj-1")
        })
      )

      expect(conv).not.toBeNull()
      expect(conv!.status).toBe("active")
      expect(conv!.projectId).toBe("proj-1")
    })

    it("should return null when no active conversation exists", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.getActiveConversation("nonexistent")
        })
      )

      expect(conv).toBeNull()
    })

    it("should not return archived conversations", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.createConversation("proj-1")
          yield* svc.archiveConversation(c.id, "Done talking")
          return yield* svc.getActiveConversation("proj-1")
        })
      )

      expect(conv).toBeNull()
    })

    it("should filter by null projectId correctly", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.createConversation(null)
          yield* svc.createConversation("proj-1")
          return yield* svc.getActiveConversation(null)
        })
      )

      expect(conv).not.toBeNull()
      expect(conv!.projectId).toBeNull()
    })
  })

  describe("updateConversationSession", () => {
    it("should update the claude session id", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.createConversation("proj-1")
          yield* svc.updateConversationSession(c.id, "claude-session-xyz")
          return yield* svc.getActiveConversation("proj-1")
        })
      )

      expect(conv!.claudeSessionId).toBe("claude-session-xyz")
    })
  })

  describe("updateConversationContext", () => {
    it("should update the context usage percent", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.createConversation("proj-1")
          yield* svc.updateConversationContext(c.id, 75.5)
          return yield* svc.getActiveConversation("proj-1")
        })
      )

      expect(conv!.contextUsagePercent).toBe(75.5)
    })
  })

  describe("archiveConversation", () => {
    it("should archive a conversation with summary", async () => {
      const conversations = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.createConversation("proj-1")
          yield* svc.archiveConversation(c.id, "Discussion about feature X")
          return yield* svc.getRecentConversations("proj-1", 10)
        })
      )

      const archived = conversations.find((c) => c.status === "archived")
      expect(archived).toBeDefined()
      expect(archived!.summary).toBe("Discussion about feature X")
    })
  })

  describe("getRecentConversations", () => {
    it("should return conversations ordered by last_message_at DESC", async () => {
      const conversations = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c1 = yield* svc.createConversation("proj-1")
          yield* svc.createConversation("proj-1")
          // Update c1 to make it identifiable — updateConversationSession
          // sets last_message_at to Date.now() which is >= c2's creation time
          yield* svc.updateConversationSession(c1.id, "updated-first")
          return yield* svc.getRecentConversations("proj-1", 10)
        })
      )

      expect(conversations.length).toBeGreaterThanOrEqual(2)
      // c1 was updated most recently so should be first
      expect(conversations[0].claudeSessionId).toBe("updated-first")
    })

    it("should respect limit", async () => {
      const conversations = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.createConversation("proj-1")
          yield* svc.createConversation("proj-1")
          yield* svc.createConversation("proj-1")
          return yield* svc.getRecentConversations("proj-1", 2)
        })
      )

      expect(conversations).toHaveLength(2)
    })
  })

  describe("incrementMessageCount", () => {
    it("should increment message count by 1", async () => {
      const conv = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          const c = yield* svc.createConversation("proj-1")
          yield* svc.incrementMessageCount(c.id)
          yield* svc.incrementMessageCount(c.id)
          yield* svc.incrementMessageCount(c.id)
          return yield* svc.getActiveConversation("proj-1")
        })
      )

      expect(conv!.messageCount).toBe(3)
    })
  })
})
