/**
 * Unit Tests for Conversation Repository (AppPersistence conversation + message methods)
 *
 * Tests CRUD operations, message encryption round-trip, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import {
  AppPersistence,
  AppPersistenceLive,
  type AppMessage,
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
  const dbDir = path.join(tmpDir, `maslow-conv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("ConversationRepository (AppPersistence conversation + message methods)", () => {
  let tempDbDir: string

  beforeEach(() => {
    tempDbDir = createTempDbDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDbDir)
  })

  const runWithAppPersistence = <A>(
    effect: Effect.Effect<A, unknown, AppPersistence>,
    dir: string = tempDbDir
  ): Promise<A> => {
    const testConfigLayer = createTestConfigLayer(dir)
    const testLayer = AppPersistenceLive.pipe(Layer.provide(testConfigLayer))
    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer))
    )
  }

  describe("createConversation", () => {
    it("should create a conversation with defaults", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.createConversation("project-1")
        })
      )

      expect(result.id).toBeTruthy()
      expect(result.projectId).toBe("project-1")
      expect(result.claudeSessionId).toBe("")
      expect(result.status).toBe("active")
      expect(result.contextUsagePercent).toBe(0)
      expect(result.summary).toBeNull()
      expect(result.messageCount).toBe(0)
      expect(result.firstMessageAt).toBeGreaterThan(0)
      expect(result.lastMessageAt).toBeGreaterThan(0)
    })

    it("should create a conversation with null projectId", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.createConversation(null)
        })
      )

      expect(result.projectId).toBeNull()
      expect(result.status).toBe("active")
    })
  })

  describe("getActiveConversation", () => {
    it("should return the active conversation for a project", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.createConversation("project-1")
          return yield* ap.getActiveConversation("project-1")
        })
      )

      expect(result).not.toBeNull()
      expect(result!.projectId).toBe("project-1")
      expect(result!.status).toBe("active")
    })

    it("should return null when no active conversation exists", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getActiveConversation("nonexistent")
        })
      )

      expect(result).toBeNull()
    })

    it("should return null for archived conversations", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const conv = yield* ap.createConversation("project-1")
          yield* ap.archiveConversation(conv.id, "Summary text")
          return yield* ap.getActiveConversation("project-1")
        })
      )

      expect(result).toBeNull()
    })

    it("should handle null projectId lookup", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.createConversation(null)
          return yield* ap.getActiveConversation(null)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.projectId).toBeNull()
    })
  })

  describe("updateConversationSession", () => {
    it("should update the claude session id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const conv = yield* ap.createConversation("project-1")
          yield* ap.updateConversationSession(conv.id, "session-abc-123")
          return yield* ap.getActiveConversation("project-1")
        })
      )

      expect(result!.claudeSessionId).toBe("session-abc-123")
    })
  })

  describe("updateConversationContext", () => {
    it("should update context usage percent", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const conv = yield* ap.createConversation("project-1")
          yield* ap.updateConversationContext(conv.id, 75.5)
          return yield* ap.getActiveConversation("project-1")
        })
      )

      expect(result!.contextUsagePercent).toBe(75.5)
    })
  })

  describe("archiveConversation", () => {
    it("should archive with summary", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const conv = yield* ap.createConversation("project-1")
          yield* ap.archiveConversation(conv.id, "Discussed architecture decisions")
          const conversations = yield* ap.getRecentConversations("project-1", 10)
          return conversations.find((c) => c.id === conv.id)
        })
      )

      expect(result!.status).toBe("archived")
      expect(result!.summary).toBe("Discussed architecture decisions")
    })
  })

  describe("getRecentConversations", () => {
    it("should return conversations ordered by last message time", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.createConversation("project-1")
          yield* ap.createConversation("project-1")
          yield* ap.createConversation("project-1")
          return yield* ap.getRecentConversations("project-1", 10)
        })
      )

      expect(result.length).toBe(3)
      // Most recent first
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].lastMessageAt).toBeGreaterThanOrEqual(result[i + 1].lastMessageAt)
      }
    })

    it("should respect limit parameter", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          yield* ap.createConversation("project-1")
          yield* ap.createConversation("project-1")
          yield* ap.createConversation("project-1")
          return yield* ap.getRecentConversations("project-1", 2)
        })
      )

      expect(result.length).toBe(2)
    })
  })

  describe("incrementMessageCount", () => {
    it("should increment message count", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const conv = yield* ap.createConversation("project-1")
          yield* ap.incrementMessageCount(conv.id)
          yield* ap.incrementMessageCount(conv.id)
          yield* ap.incrementMessageCount(conv.id)
          return yield* ap.getActiveConversation("project-1")
        })
      )

      expect(result!.messageCount).toBe(3)
    })
  })

  describe("saveMessage and getMessages", () => {
    it("should save and retrieve a message with encryption round-trip", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const message: AppMessage = {
            id: "msg-1",
            projectId: project.id,
            role: "user",
            content: "Hello, this is a secret message!",
            timestamp: Date.now(),
          }
          yield* ap.saveMessage(message)
          return yield* ap.getMessages(project.id, 10, 0)
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe("Hello, this is a secret message!")
      expect(result[0].role).toBe("user")
      expect(result[0].id).toBe("msg-1")
    })

    it("should encrypt and decrypt message content transparently", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const content = "Sensitive data: API_KEY=sk-1234567890"
          const message: AppMessage = {
            id: "msg-encrypted",
            projectId: project.id,
            role: "assistant",
            content,
            timestamp: Date.now(),
          }
          yield* ap.saveMessage(message)
          const messages = yield* ap.getMessages(project.id, 10, 0)
          return messages[0]
        })
      )

      expect(result.content).toBe("Sensitive data: API_KEY=sk-1234567890")
    })

    it("should handle messages with metadata", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const message: AppMessage = {
            id: "msg-meta",
            projectId: project.id,
            role: "assistant",
            content: "Response",
            timestamp: Date.now(),
            metadata: { tokens: { input: 100, output: 50 }, cost: 0.005 },
          }
          yield* ap.saveMessage(message)
          return yield* ap.getMessages(project.id, 10, 0)
        })
      )

      expect(result[0].metadata).toEqual({
        tokens: { input: 100, output: 50 },
        cost: 0.005,
      })
    })

    it("should handle messages with null projectId", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const message: AppMessage = {
            id: "msg-null-proj",
            projectId: null,
            role: "user",
            content: "No project",
            timestamp: Date.now(),
          }
          yield* ap.saveMessage(message)
          return yield* ap.getMessages(null, 10, 0)
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0].projectId).toBeNull()
    })

    it("should handle messages with conversationId", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const message: AppMessage = {
            id: "msg-conv",
            projectId: project.id,
            conversationId: "conv-123",
            role: "user",
            content: "Linked to conversation",
            timestamp: Date.now(),
          }
          yield* ap.saveMessage(message)
          return yield* ap.getMessages(project.id, 10, 0)
        })
      )

      expect(result[0].conversationId).toBe("conv-123")
    })

    it("should respect limit and offset in getMessages", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          for (let i = 0; i < 5; i++) {
            yield* ap.saveMessage({
              id: `msg-${i}`,
              projectId: project.id,
              role: "user",
              content: `Message ${i}`,
              timestamp: Date.now() + i,
            })
          }
          const page1 = yield* ap.getMessages(project.id, 2, 0)
          const page2 = yield* ap.getMessages(project.id, 2, 2)
          return { page1, page2 }
        })
      )

      expect(result.page1).toHaveLength(2)
      expect(result.page2).toHaveLength(2)
    })

    it("should encrypt unicode and special characters correctly", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const content = "Hello 世界! 🚀 Special chars: <>&\"' \n\ttabs and newlines"
          yield* ap.saveMessage({
            id: "msg-unicode",
            projectId: project.id,
            role: "user",
            content,
            timestamp: Date.now(),
          })
          const messages = yield* ap.getMessages(project.id, 10, 0)
          return messages[0]
        })
      )

      expect(result.content).toBe("Hello 世界! 🚀 Special chars: <>&\"' \n\ttabs and newlines")
    })
  })

  describe("conversation lifecycle", () => {
    it("should support create → update session → track messages → archive flow", async () => {
      await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence

          // Create conversation
          const conv = yield* ap.createConversation("project-1")
          expect(conv.status).toBe("active")
          expect(conv.messageCount).toBe(0)

          // Update session
          yield* ap.updateConversationSession(conv.id, "claude-session-xyz")
          const updated = yield* ap.getActiveConversation("project-1")
          expect(updated!.claudeSessionId).toBe("claude-session-xyz")

          // Track messages
          yield* ap.incrementMessageCount(conv.id)
          yield* ap.incrementMessageCount(conv.id)

          // Update context
          yield* ap.updateConversationContext(conv.id, 45.2)

          // Archive
          yield* ap.archiveConversation(conv.id, "Session completed successfully")

          // No active conversation anymore
          const active = yield* ap.getActiveConversation("project-1")
          expect(active).toBeNull()

          // But it appears in recent conversations
          const recent = yield* ap.getRecentConversations("project-1", 10)
          expect(recent).toHaveLength(1)
          expect(recent[0].status).toBe("archived")
          expect(recent[0].summary).toBe("Session completed successfully")
        })
      )
    })
  })
})
