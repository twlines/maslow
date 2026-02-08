/**
 * Tests for AppPersistence message operations.
 *
 * Covers: saveMessage, getMessages, encryption round-trip,
 * null projectId path, metadata handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence, type AppMessage } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("MessageRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  describe("saveMessage and getMessages", () => {
    it("should save and retrieve a message", async () => {
      const msg: AppMessage = {
        id: "msg-1",
        projectId: "proj-1",
        role: "user",
        content: "Hello world",
        timestamp: Date.now(),
      }

      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage(msg)
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("msg-1")
      expect(messages[0].projectId).toBe("proj-1")
      expect(messages[0].role).toBe("user")
      expect(messages[0].content).toBe("Hello world")
    })

    it("should encrypt and decrypt content (round-trip)", async () => {
      const secret = "This is a secret message with special chars: é ñ 🎉"

      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "enc-1",
            projectId: "proj-1",
            role: "assistant",
            content: secret,
            timestamp: Date.now(),
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe(secret)
    })

    it("should handle empty content encryption", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "enc-empty",
            projectId: "proj-1",
            role: "user",
            content: "",
            timestamp: Date.now(),
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages[0].content).toBe("")
    })

    it("should preserve metadata", async () => {
      const meta = { tokens: { input: 100, output: 200 }, cost: 0.05 }

      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "meta-1",
            projectId: "proj-1",
            role: "assistant",
            content: "Response",
            timestamp: Date.now(),
            metadata: meta,
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages[0].metadata).toEqual(meta)
    })

    it("should return undefined metadata when not set", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "nometa-1",
            projectId: "proj-1",
            role: "user",
            content: "No meta",
            timestamp: Date.now(),
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages[0].metadata).toBeUndefined()
    })

    it("should store conversationId", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "conv-msg-1",
            projectId: "proj-1",
            conversationId: "conv-1",
            role: "user",
            content: "In conversation",
            timestamp: Date.now(),
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages[0].conversationId).toBe("conv-1")
    })
  })

  describe("getMessages with null projectId", () => {
    it("should return all messages when projectId is null", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "m1",
            projectId: "proj-1",
            role: "user",
            content: "Project 1",
            timestamp: 1000,
          })
          yield* svc.saveMessage({
            id: "m2",
            projectId: "proj-2",
            role: "user",
            content: "Project 2",
            timestamp: 2000,
          })
          yield* svc.saveMessage({
            id: "m3",
            projectId: null,
            role: "user",
            content: "No project",
            timestamp: 3000,
          })
          return yield* svc.getMessages(null, 10, 0)
        })
      )

      expect(messages).toHaveLength(3)
    })

    it("should filter by specific projectId", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "f1",
            projectId: "proj-a",
            role: "user",
            content: "A",
            timestamp: 1000,
          })
          yield* svc.saveMessage({
            id: "f2",
            projectId: "proj-b",
            role: "user",
            content: "B",
            timestamp: 2000,
          })
          return yield* svc.getMessages("proj-a", 10, 0)
        })
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].projectId).toBe("proj-a")
    })
  })

  describe("pagination", () => {
    it("should respect limit and offset", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          for (let i = 0; i < 5; i++) {
            yield* svc.saveMessage({
              id: `page-${i}`,
              projectId: "proj-1",
              role: "user",
              content: `Message ${i}`,
              timestamp: i * 1000,
            })
          }
          return yield* svc.getMessages("proj-1", 2, 1)
        })
      )

      expect(messages).toHaveLength(2)
    })

    it("should order by timestamp descending", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          yield* svc.saveMessage({
            id: "old",
            projectId: "proj-1",
            role: "user",
            content: "Old",
            timestamp: 1000,
          })
          yield* svc.saveMessage({
            id: "new",
            projectId: "proj-1",
            role: "user",
            content: "New",
            timestamp: 2000,
          })
          return yield* svc.getMessages("proj-1", 10, 0)
        })
      )

      expect(messages[0].id).toBe("new")
      expect(messages[1].id).toBe("old")
    })
  })

  describe("empty results", () => {
    it("should return empty array for non-existent project", async () => {
      const messages = await run(
        Effect.gen(function* () {
          const svc = yield* AppPersistence
          return yield* svc.getMessages("nonexistent", 10, 0)
        })
      )

      expect(messages).toEqual([])
    })
  })
})
