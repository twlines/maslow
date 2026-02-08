/**
 * Tests for AppPersistence kanban card operations.
 *
 * Covers: CRUD, ordering (position auto-increment), moveCard,
 * work queue (getNextCard priority, startCard, completeCard,
 * skipCardToBack, assignCardAgent, updateCardAgentStatus, saveCardContext).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("KanbanRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  const setupProject = Effect.gen(function* () {
    const svc = yield* AppPersistence
    const project = yield* svc.createProject("Kanban Test Project", "For testing kanban")
    return { svc, projectId: project.id }
  })

  describe("createCard", () => {
    it("should create a card with defaults", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          return yield* svc.createCard(projectId, "My Card", "Description")
        })
      )

      expect(card.title).toBe("My Card")
      expect(card.description).toBe("Description")
      expect(card.column).toBe("backlog")
      expect(card.labels).toEqual([])
      expect(card.position).toBe(0)
      expect(card.priority).toBe(0)
      expect(card.assignedAgent).toBeNull()
      expect(card.agentStatus).toBeNull()
      expect(card.startedAt).toBeNull()
      expect(card.completedAt).toBeNull()
    })

    it("should create a card in a specific column", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          return yield* svc.createCard(projectId, "In Progress", "Desc", "in_progress")
        })
      )

      expect(card.column).toBe("in_progress")
    })

    it("should auto-increment position within a column", async () => {
      const [card1, card2, card3] = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c1 = yield* svc.createCard(projectId, "Card 1", "")
          const c2 = yield* svc.createCard(projectId, "Card 2", "")
          const c3 = yield* svc.createCard(projectId, "Card 3", "")
          return [c1, c2, c3] as const
        })
      )

      expect(card1.position).toBe(0)
      expect(card2.position).toBe(1)
      expect(card3.position).toBe(2)
    })

    it("should track positions independently per column", async () => {
      const [backlog, inProgress] = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const b = yield* svc.createCard(projectId, "Backlog", "", "backlog")
          const ip = yield* svc.createCard(projectId, "In Progress", "", "in_progress")
          return [b, ip] as const
        })
      )

      expect(backlog.position).toBe(0)
      expect(inProgress.position).toBe(0)
    })
  })

  describe("getCard", () => {
    it("should retrieve a card by id", async () => {
      const result = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const created = yield* svc.createCard(projectId, "Find Me", "Here")
          return yield* svc.getCard(created.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Find Me")
    })

    it("should return null for non-existent card", async () => {
      const result = await run(
        Effect.gen(function* () {
          const { svc } = yield* setupProject
          return yield* svc.getCard("nonexistent-id")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("getCards", () => {
    it("should return all cards for a project ordered by column and position", async () => {
      const cards = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createCard(projectId, "Backlog 1", "", "backlog")
          yield* svc.createCard(projectId, "Backlog 2", "", "backlog")
          yield* svc.createCard(projectId, "In Progress", "", "in_progress")
          return yield* svc.getCards(projectId)
        })
      )

      expect(cards).toHaveLength(3)
      expect(cards[0].column).toBe("backlog")
      expect(cards[1].column).toBe("backlog")
      expect(cards[2].column).toBe("in_progress")
    })

    it("should return empty array for project with no cards", async () => {
      const cards = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          return yield* svc.getCards(projectId)
        })
      )

      expect(cards).toEqual([])
    })
  })

  describe("updateCard", () => {
    it("should update card title and description", async () => {
      const updated = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Original", "Old desc")
          yield* svc.updateCard(card.id, { title: "Updated", description: "New desc" })
          return yield* svc.getCard(card.id)
        })
      )

      expect(updated!.title).toBe("Updated")
      expect(updated!.description).toBe("New desc")
    })

    it("should update labels as JSON", async () => {
      const updated = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Labels", "")
          yield* svc.updateCard(card.id, { labels: ["bug", "urgent"] })
          return yield* svc.getCard(card.id)
        })
      )

      expect(updated!.labels).toEqual(["bug", "urgent"])
    })

    it("should only update specified fields (COALESCE)", async () => {
      const updated = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Keep Title", "Keep Desc")
          yield* svc.updateCard(card.id, { title: "Changed" })
          return yield* svc.getCard(card.id)
        })
      )

      expect(updated!.title).toBe("Changed")
      expect(updated!.description).toBe("Keep Desc")
    })
  })

  describe("deleteCard", () => {
    it("should delete a card", async () => {
      const result = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Delete Me", "")
          yield* svc.deleteCard(card.id)
          return yield* svc.getCard(card.id)
        })
      )

      expect(result).toBeNull()
    })

    it("should not error when deleting non-existent card", async () => {
      await expect(
        run(
          Effect.gen(function* () {
            const { svc } = yield* setupProject
            yield* svc.deleteCard("nonexistent")
          })
        )
      ).resolves.not.toThrow()
    })
  })

  describe("moveCard", () => {
    it("should move a card to a different column and position", async () => {
      const moved = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Move Me", "")
          yield* svc.moveCard(card.id, "in_progress", 5)
          return yield* svc.getCard(card.id)
        })
      )

      expect(moved!.column).toBe("in_progress")
      expect(moved!.position).toBe(5)
    })
  })

  describe("work queue — getNextCard", () => {
    it("should return the first backlog card by position", async () => {
      const next = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          yield* svc.createCard(projectId, "First Card", "")
          yield* svc.createCard(projectId, "Second Card", "")
          return yield* svc.getNextCard(projectId)
        })
      )

      expect(next).not.toBeNull()
      expect(next!.title).toBe("First Card")
      expect(next!.column).toBe("backlog")
    })

    it("should return null when no backlog cards exist", async () => {
      const next = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Done Card", "")
          yield* svc.moveCard(card.id, "done", 0)
          return yield* svc.getNextCard(projectId)
        })
      )

      expect(next).toBeNull()
    })

    it("should respect priority ordering (lower number = higher priority)", async () => {
      const next = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          // Create card A (position 0, priority 0)
          const a = yield* svc.createCard(projectId, "Card A", "")
          // Create card B (position 1, priority 0)
          yield* svc.createCard(projectId, "Card B", "")

          // Skip card A to back — increases its priority number
          yield* svc.skipCardToBack(a.id, projectId)

          // Card B should now be next since card A has higher priority number
          return yield* svc.getNextCard(projectId)
        })
      )

      expect(next!.title).toBe("Card B")
    })
  })

  describe("work queue — lifecycle", () => {
    it("should start a card (move to in_progress)", async () => {
      const started = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Start Me", "")
          yield* svc.startCard(card.id)
          return yield* svc.getCard(card.id)
        })
      )

      expect(started!.column).toBe("in_progress")
      expect(started!.startedAt).toBeTypeOf("number")
    })

    it("should complete a card (move to done)", async () => {
      const completed = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const card = yield* svc.createCard(projectId, "Complete Me", "")
          yield* svc.startCard(card.id)
          yield* svc.completeCard(card.id)
          return yield* svc.getCard(card.id)
        })
      )

      expect(completed!.column).toBe("done")
      expect(completed!.agentStatus).toBe("completed")
      expect(completed!.completedAt).toBeTypeOf("number")
    })

    it("should skip a card to back of backlog", async () => {
      const [skipped, other] = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c1 = yield* svc.createCard(projectId, "Skip Me", "")
          const c2 = yield* svc.createCard(projectId, "Other", "")
          yield* svc.skipCardToBack(c1.id, projectId)
          const s = yield* svc.getCard(c1.id)
          const o = yield* svc.getCard(c2.id)
          return [s!, o!] as const
        })
      )

      expect(skipped.column).toBe("backlog")
      expect(skipped.agentStatus).toBe("idle")
      expect(skipped.assignedAgent).toBeNull()
      // Skipped card should have higher position and priority than the other
      expect(skipped.position).toBeGreaterThan(other.position)
      expect(skipped.priority).toBeGreaterThan(other.priority)
    })
  })

  describe("agent assignment", () => {
    it("should assign an agent to a card", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c = yield* svc.createCard(projectId, "Assign", "")
          yield* svc.assignCardAgent(c.id, "claude")
          return yield* svc.getCard(c.id)
        })
      )

      expect(card!.assignedAgent).toBe("claude")
      expect(card!.agentStatus).toBe("running")
    })

    it("should update agent status", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c = yield* svc.createCard(projectId, "Status", "")
          yield* svc.assignCardAgent(c.id, "codex")
          yield* svc.updateCardAgentStatus(c.id, "blocked", "Needs review")
          return yield* svc.getCard(c.id)
        })
      )

      expect(card!.agentStatus).toBe("blocked")
      expect(card!.blockedReason).toBe("Needs review")
    })

    it("should clear blocked reason when status changes", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c = yield* svc.createCard(projectId, "Unblock", "")
          yield* svc.assignCardAgent(c.id, "gemini")
          yield* svc.updateCardAgentStatus(c.id, "blocked", "Waiting")
          yield* svc.updateCardAgentStatus(c.id, "running")
          return yield* svc.getCard(c.id)
        })
      )

      expect(card!.agentStatus).toBe("running")
      expect(card!.blockedReason).toBeNull()
    })
  })

  describe("saveCardContext", () => {
    it("should save context snapshot and session id", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c = yield* svc.createCard(projectId, "Context", "")
          yield* svc.saveCardContext(c.id, "snapshot-data", "session-123")
          return yield* svc.getCard(c.id)
        })
      )

      expect(card!.contextSnapshot).toBe("snapshot-data")
      expect(card!.lastSessionId).toBe("session-123")
    })

    it("should save context snapshot without session id", async () => {
      const card = await run(
        Effect.gen(function* () {
          const { svc, projectId } = yield* setupProject
          const c = yield* svc.createCard(projectId, "No Session", "")
          yield* svc.saveCardContext(c.id, "just-snapshot")
          return yield* svc.getCard(c.id)
        })
      )

      expect(card!.contextSnapshot).toBe("just-snapshot")
      expect(card!.lastSessionId).toBeNull()
    })
  })
})
