/**
 * Unit Tests for Card Repository (AppPersistence kanban card methods)
 *
 * Tests CRUD operations, work queue logic, agent assignment, and edge cases.
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
  const dbDir = path.join(tmpDir, `maslow-card-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("CardRepository (AppPersistence kanban card methods)", () => {
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

  describe("createCard", () => {
    it("should create a card with default column 'backlog'", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.createCard(project.id, "My Card", "Card description")
        })
      )

      expect(result.title).toBe("My Card")
      expect(result.description).toBe("Card description")
      expect(result.column).toBe("backlog")
      expect(result.labels).toEqual([])
      expect(result.linkedDecisionIds).toEqual([])
      expect(result.linkedMessageIds).toEqual([])
      expect(result.position).toBe(0)
      expect(result.priority).toBe(0)
      expect(result.assignedAgent).toBeNull()
      expect(result.agentStatus).toBeNull()
      expect(result.startedAt).toBeNull()
      expect(result.completedAt).toBeNull()
    })

    it("should create a card in a specific column", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.createCard(project.id, "In Progress Card", "desc", "in_progress")
        })
      )

      expect(result.column).toBe("in_progress")
    })

    it("should auto-increment position within a column", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card1 = yield* ap.createCard(project.id, "Card 1", "desc")
          const card2 = yield* ap.createCard(project.id, "Card 2", "desc")
          const card3 = yield* ap.createCard(project.id, "Card 3", "desc")
          return { card1, card2, card3 }
        })
      )

      expect(result.card1.position).toBe(0)
      expect(result.card2.position).toBe(1)
      expect(result.card3.position).toBe(2)
    })

    it("should track positions independently per column", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const backlog = yield* ap.createCard(project.id, "Backlog 1", "desc", "backlog")
          const inProgress = yield* ap.createCard(project.id, "IP 1", "desc", "in_progress")
          return { backlog, inProgress }
        })
      )

      expect(result.backlog.position).toBe(0)
      expect(result.inProgress.position).toBe(0)
    })
  })

  describe("getCard", () => {
    it("should retrieve a card by id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const created = yield* ap.createCard(project.id, "Find Me", "details")
          return yield* ap.getCard(created.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Find Me")
      expect(result!.description).toBe("details")
    })

    it("should return null for non-existent card", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          return yield* ap.getCard("nonexistent-id")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("getCards", () => {
    it("should return all cards for a project", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createCard(project.id, "Card A", "desc")
          yield* ap.createCard(project.id, "Card B", "desc")
          yield* ap.createCard(project.id, "Card C", "desc", "in_progress")
          return yield* ap.getCards(project.id)
        })
      )

      expect(result).toHaveLength(3)
    })

    it("should return empty array for project with no cards", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.getCards(project.id)
        })
      )

      expect(result).toEqual([])
    })

    it("should isolate cards between projects", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const p1 = yield* ap.createProject("Project 1", "desc")
          const p2 = yield* ap.createProject("Project 2", "desc")
          yield* ap.createCard(p1.id, "P1 Card", "desc")
          yield* ap.createCard(p2.id, "P2 Card A", "desc")
          yield* ap.createCard(p2.id, "P2 Card B", "desc")
          const p1Cards = yield* ap.getCards(p1.id)
          const p2Cards = yield* ap.getCards(p2.id)
          return { p1Cards, p2Cards }
        })
      )

      expect(result.p1Cards).toHaveLength(1)
      expect(result.p2Cards).toHaveLength(2)
    })
  })

  describe("updateCard", () => {
    it("should update card title", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Old Title", "desc")
          yield* ap.updateCard(card.id, { title: "New Title" })
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.title).toBe("New Title")
    })

    it("should update card labels", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.updateCard(card.id, { labels: ["bug", "urgent"] })
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.labels).toEqual(["bug", "urgent"])
    })

    it("should update multiple fields at once", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.updateCard(card.id, {
            title: "Updated",
            description: "New desc",
            column: "in_progress",
          })
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.title).toBe("Updated")
      expect(result!.description).toBe("New desc")
      expect(result!.column).toBe("in_progress")
    })

    it("should update updatedAt timestamp", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          const originalUpdatedAt = card.updatedAt
          // Small delay to ensure timestamp differs
          yield* Effect.sync(() => {
            const start = Date.now()
            while (Date.now() - start < 5) { /* busy wait */ }
          })
          yield* ap.updateCard(card.id, { title: "Changed" })
          const updated = yield* ap.getCard(card.id)
          return { originalUpdatedAt, newUpdatedAt: updated!.updatedAt }
        })
      )

      expect(result.newUpdatedAt).toBeGreaterThanOrEqual(result.originalUpdatedAt)
    })
  })

  describe("deleteCard", () => {
    it("should delete a card", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "To Delete", "desc")
          yield* ap.deleteCard(card.id)
          return yield* ap.getCard(card.id)
        })
      )

      expect(result).toBeNull()
    })

    it("should not error when deleting non-existent card", async () => {
      await expect(
        runWithAppPersistence(
          Effect.gen(function* () {
            const ap = yield* AppPersistence
            yield* ap.deleteCard("nonexistent-id")
          })
        )
      ).resolves.not.toThrow()
    })
  })

  describe("moveCard", () => {
    it("should move a card to a different column", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.moveCard(card.id, "in_progress", 0)
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.column).toBe("in_progress")
      expect(result!.position).toBe(0)
    })

    it("should update position when moving", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.moveCard(card.id, "done", 5)
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.column).toBe("done")
      expect(result!.position).toBe(5)
    })
  })

  describe("getNextCard (work queue logic)", () => {
    it("should return the highest priority backlog card", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createCard(project.id, "Card A", "desc")
          yield* ap.createCard(project.id, "Card B", "desc")
          yield* ap.createCard(project.id, "Card C", "desc")
          return yield* ap.getNextCard(project.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Card A")
    })

    it("should return null when no backlog cards exist", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          return yield* ap.getNextCard(project.id)
        })
      )

      expect(result).toBeNull()
    })

    it("should skip cards not in backlog", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          yield* ap.createCard(project.id, "In Progress", "desc", "in_progress")
          yield* ap.createCard(project.id, "Done", "desc", "done")
          return yield* ap.getNextCard(project.id)
        })
      )

      expect(result).toBeNull()
    })

    it("should respect priority ordering", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          // Create cards - all at priority 0 by default, so first created is first
          const cardA = yield* ap.createCard(project.id, "Low Priority", "desc")
          yield* ap.createCard(project.id, "Also Low", "desc")
          // Skip cardA to back - this increases its priority number (lower priority)
          yield* ap.skipCardToBack(cardA.id, project.id)
          return yield* ap.getNextCard(project.id)
        })
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Also Low")
    })
  })

  describe("saveCardContext", () => {
    it("should save context snapshot and session id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.saveCardContext(card.id, "context-data-here", "session-123")
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.contextSnapshot).toBe("context-data-here")
      expect(result!.lastSessionId).toBe("session-123")
    })

    it("should save context without session id", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.saveCardContext(card.id, "context-only")
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.contextSnapshot).toBe("context-only")
      expect(result!.lastSessionId).toBeNull()
    })
  })

  describe("assignCardAgent", () => {
    it("should assign an agent and set status to running", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.assignCardAgent(card.id, "claude")
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.assignedAgent).toBe("claude")
      expect(result!.agentStatus).toBe("running")
    })
  })

  describe("updateCardAgentStatus", () => {
    it("should update agent status", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.assignCardAgent(card.id, "claude")
          yield* ap.updateCardAgentStatus(card.id, "blocked", "Waiting for review")
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.agentStatus).toBe("blocked")
      expect(result!.blockedReason).toBe("Waiting for review")
    })

    it("should clear blocked reason when status changes", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.assignCardAgent(card.id, "claude")
          yield* ap.updateCardAgentStatus(card.id, "blocked", "Reason")
          yield* ap.updateCardAgentStatus(card.id, "running")
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.agentStatus).toBe("running")
      expect(result!.blockedReason).toBeNull()
    })
  })

  describe("startCard", () => {
    it("should move card to in_progress and set startedAt", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.startCard(card.id)
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.column).toBe("in_progress")
      expect(result!.startedAt).not.toBeNull()
      expect(result!.startedAt).toBeGreaterThan(0)
    })
  })

  describe("completeCard", () => {
    it("should move card to done and set completedAt", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card = yield* ap.createCard(project.id, "Card", "desc")
          yield* ap.startCard(card.id)
          yield* ap.completeCard(card.id)
          return yield* ap.getCard(card.id)
        })
      )

      expect(result!.column).toBe("done")
      expect(result!.agentStatus).toBe("completed")
      expect(result!.completedAt).not.toBeNull()
      expect(result!.completedAt).toBeGreaterThan(0)
    })
  })

  describe("skipCardToBack", () => {
    it("should move card to back of backlog with lowest priority", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")
          const card1 = yield* ap.createCard(project.id, "Card 1", "desc")
          yield* ap.createCard(project.id, "Card 2", "desc")
          yield* ap.skipCardToBack(card1.id, project.id)
          const skipped = yield* ap.getCard(card1.id)
          const next = yield* ap.getNextCard(project.id)
          return { skipped, next }
        })
      )

      expect(result.skipped!.column).toBe("backlog")
      expect(result.skipped!.agentStatus).toBe("idle")
      expect(result.skipped!.assignedAgent).toBeNull()
      // Card 2 should now be next since card 1 was skipped to back
      expect(result.next!.title).toBe("Card 2")
    })
  })

  describe("full work queue lifecycle", () => {
    it("should support create → assign → start → complete flow", async () => {
      const result = await runWithAppPersistence(
        Effect.gen(function* () {
          const ap = yield* AppPersistence
          const project = yield* ap.createProject("Test", "desc")

          // Create card
          const card = yield* ap.createCard(project.id, "Work Item", "Do the thing")
          expect(card.column).toBe("backlog")

          // Get next from queue
          const next = yield* ap.getNextCard(project.id)
          expect(next!.id).toBe(card.id)

          // Assign agent
          yield* ap.assignCardAgent(card.id, "claude")
          const assigned = yield* ap.getCard(card.id)
          expect(assigned!.assignedAgent).toBe("claude")
          expect(assigned!.agentStatus).toBe("running")

          // Start work
          yield* ap.startCard(card.id)
          const started = yield* ap.getCard(card.id)
          expect(started!.column).toBe("in_progress")
          expect(started!.startedAt).not.toBeNull()

          // Save context mid-work
          yield* ap.saveCardContext(card.id, "work in progress snapshot", "session-abc")

          // Complete work
          yield* ap.completeCard(card.id)
          const completed = yield* ap.getCard(card.id)
          expect(completed!.column).toBe("done")
          expect(completed!.agentStatus).toBe("completed")
          expect(completed!.completedAt).not.toBeNull()

          // No more cards in queue
          const empty = yield* ap.getNextCard(project.id)
          expect(empty).toBeNull()

          return completed
        })
      )

      expect(result!.title).toBe("Work Item")
    })
  })
})
