/**
 * Unit Tests for Kanban Service
 *
 * Tests board grouping, card movement, work queue ordering,
 * and createCardFromConversation title extraction.
 * Uses mocked AppPersistence dependency.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { Kanban, KanbanLive } from "../../services/Kanban.js"
import {
  AppPersistence,
  type AppPersistenceService,
  type AppKanbanCard,
} from "../../services/AppPersistence.js"

// In-memory card store for mock
let cards: AppKanbanCard[] = []
let auditLogs: Array<{ entityType: string; entityId: string; action: string; details?: Record<string, unknown> }> = []

const makeCard = (overrides: Partial<AppKanbanCard> & { id: string; projectId: string; title: string }): AppKanbanCard => ({
  description: "",
  column: "backlog",
  labels: [],
  linkedDecisionIds: [],
  linkedMessageIds: [],
  position: 0,
  priority: 0,
  contextSnapshot: null,
  lastSessionId: null,
  assignedAgent: null,
  agentStatus: null,
  blockedReason: null,
  startedAt: null,
  completedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

const mockAppPersistence: AppPersistenceService = {
  getCards: (projectId) =>
    Effect.sync(() => cards.filter((c) => c.projectId === projectId)),
  getCard: (id) =>
    Effect.sync(() => cards.find((c) => c.id === id) ?? null),
  createCard: (projectId, title, description, column = "backlog") =>
    Effect.sync(() => {
      const card = makeCard({
        id: `card-${cards.length + 1}`,
        projectId,
        title,
        description,
        column: column as AppKanbanCard["column"],
        position: cards.filter((c) => c.projectId === projectId && c.column === column).length,
      })
      cards.push(card)
      return card
    }),
  updateCard: () => Effect.void,
  deleteCard: (id) =>
    Effect.sync(() => {
      cards = cards.filter((c) => c.id !== id)
    }),
  moveCard: (id, column, position) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.column = column as AppKanbanCard["column"]
        card.position = position
      }
    }),
  getNextCard: (projectId) =>
    Effect.sync(() => {
      const backlog = cards
        .filter((c) => c.projectId === projectId && c.column === "backlog")
        .sort((a, b) => a.priority - b.priority || a.position - b.position)
      return backlog[0] ?? null
    }),
  saveCardContext: (id, snapshot, sessionId) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.contextSnapshot = snapshot
        card.lastSessionId = sessionId ?? null
      }
    }),
  assignCardAgent: (id, agent) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.assignedAgent = agent
        card.agentStatus = "running"
      }
    }),
  updateCardAgentStatus: (id, status, reason) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.agentStatus = status
        card.blockedReason = reason ?? null
      }
    }),
  startCard: (id) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.column = "in_progress"
        card.startedAt = Date.now()
      }
    }),
  completeCard: (id) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        card.column = "done"
        card.agentStatus = "completed"
        card.completedAt = Date.now()
      }
    }),
  skipCardToBack: (id, projectId) =>
    Effect.sync(() => {
      const card = cards.find((c) => c.id === id)
      if (card) {
        const maxPos = Math.max(...cards.filter((c) => c.projectId === projectId && c.column === "backlog").map((c) => c.position), 0)
        card.column = "backlog"
        card.position = maxPos + 1
      }
    }),
  logAudit: (entityType, entityId, action, details) =>
    Effect.sync(() => {
      auditLogs.push({ entityType, entityId, action, details })
    }),
  // Stubs for unused methods
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
  getActiveConversation: () => Effect.succeed(null),
  createConversation: () => Effect.succeed(null as never),
  updateConversationSession: () => Effect.void,
  updateConversationContext: () => Effect.void,
  archiveConversation: () => Effect.void,
  getRecentConversations: () => Effect.succeed([]),
  incrementMessageCount: () => Effect.void,
  getProjects: () => Effect.succeed([]),
  getProject: () => Effect.succeed(null),
  createProject: () => Effect.succeed(null as never),
  updateProject: () => Effect.void,
  getProjectDocuments: () => Effect.succeed([]),
  getProjectDocument: () => Effect.succeed(null),
  createProjectDocument: () => Effect.succeed(null as never),
  updateProjectDocument: () => Effect.void,
  addCorrection: () => Effect.succeed(null as never),
  getCorrections: () => Effect.succeed([]),
  deactivateCorrection: () => Effect.void,
  reactivateCorrection: () => Effect.void,
  deleteCorrection: () => Effect.void,
  insertTokenUsage: () => Effect.succeed(null as never),
  getDecisions: () => Effect.succeed([]),
  getDecision: () => Effect.succeed(null),
  createDecision: () => Effect.succeed(null as never),
  updateDecision: () => Effect.void,
  getUsageSummary: () => Effect.succeed(null as never),
}

const testLayer = KanbanLive.pipe(
  Layer.provide(Layer.succeed(AppPersistence, mockAppPersistence))
)

const runWithKanban = <A>(
  effect: Effect.Effect<A, unknown, Kanban>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, testLayer))

describe("Kanban Service", () => {
  beforeEach(() => {
    cards = []
    auditLogs = []
  })

  describe("getBoard", () => {
    it("should group cards by column", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Backlog 1", column: "backlog", position: 0 }),
        makeCard({ id: "2", projectId: "p1", title: "In Progress 1", column: "in_progress", position: 0 }),
        makeCard({ id: "3", projectId: "p1", title: "Done 1", column: "done", position: 0 }),
        makeCard({ id: "4", projectId: "p1", title: "Backlog 2", column: "backlog", position: 1 }),
      ]

      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.getBoard("p1")
        })
      )

      expect(board.backlog).toHaveLength(2)
      expect(board.in_progress).toHaveLength(1)
      expect(board.done).toHaveLength(1)
    })

    it("should sort cards by position within each column", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Third", column: "backlog", position: 2 }),
        makeCard({ id: "2", projectId: "p1", title: "First", column: "backlog", position: 0 }),
        makeCard({ id: "3", projectId: "p1", title: "Second", column: "backlog", position: 1 }),
      ]

      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.getBoard("p1")
        })
      )

      expect(board.backlog[0].title).toBe("First")
      expect(board.backlog[1].title).toBe("Second")
      expect(board.backlog[2].title).toBe("Third")
    })

    it("should return empty arrays for a project with no cards", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.getBoard("empty-project")
        })
      )

      expect(board.backlog).toHaveLength(0)
      expect(board.in_progress).toHaveLength(0)
      expect(board.done).toHaveLength(0)
    })
  })

  describe("moveCard", () => {
    it("should move a card to the end of the target column", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Existing", column: "in_progress", position: 0 }),
        makeCard({ id: "2", projectId: "p1", title: "To Move", column: "backlog", position: 0 }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.moveCard("2", "in_progress")
        })
      )

      const movedCard = cards.find((c) => c.id === "2")
      expect(movedCard?.column).toBe("in_progress")
      expect(movedCard?.position).toBe(1) // After existing card at position 0
    })

    it("should log an audit entry when moving a card", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Card", column: "backlog", position: 0 }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.moveCard("1", "in_progress")
        })
      )

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0].action).toBe("card.moved")
      expect(auditLogs[0].details).toEqual({ from: "backlog", to: "in_progress" })
    })

    it("should not error when card does not exist", async () => {
      await expect(
        runWithKanban(
          Effect.gen(function* () {
            const kanban = yield* Kanban
            yield* kanban.moveCard("nonexistent", "done")
          })
        )
      ).resolves.not.toThrow()
    })
  })

  describe("createCardFromConversation", () => {
    it("should extract title from first sentence", async () => {
      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCardFromConversation(
            "p1",
            "Add user authentication. We need OAuth2 support for the API."
          )
        })
      )

      expect(card.title).toBe("Add user authentication")
    })

    it("should truncate titles longer than 80 characters", async () => {
      const longText = "This is a very long sentence that goes well beyond eighty characters and should be truncated with an ellipsis at the end"

      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCardFromConversation("p1", longText)
        })
      )

      expect(card.title.length).toBeLessThanOrEqual(80)
      expect(card.title.endsWith("...")).toBe(true)
    })

    it("should use full text as description", async () => {
      const text = "Implement caching. Redis for session storage."

      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCardFromConversation("p1", text)
        })
      )

      expect(card.description).toBe(text)
    })

    it("should handle text without sentence delimiters", async () => {
      const text = "Short task"

      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCardFromConversation("p1", text)
        })
      )

      expect(card.title).toBe("Short task")
    })

    it("should handle exclamation and question marks as sentence boundaries", async () => {
      const text = "Fix the critical bug! The server crashes on startup."

      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCardFromConversation("p1", text)
        })
      )

      expect(card.title).toBe("Fix the critical bug")
    })
  })

  describe("work queue operations", () => {
    it("getNext should return the next backlog card", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "First", column: "backlog", position: 0, priority: 0 }),
        makeCard({ id: "2", projectId: "p1", title: "Second", column: "backlog", position: 1, priority: 0 }),
      ]

      const next = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.getNext("p1")
        })
      )

      expect(next).not.toBeNull()
      expect(next?.title).toBe("First")
    })

    it("getNext should return null when no backlog cards", async () => {
      const next = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.getNext("p1")
        })
      )

      expect(next).toBeNull()
    })

    it("startWork should move card to in_progress and log audit", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Card", column: "backlog", position: 0 }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.startWork("1", "claude")
        })
      )

      expect(cards[0].column).toBe("in_progress")
      expect(cards[0].assignedAgent).toBe("claude")
      expect(auditLogs.some((l) => l.action === "card.started")).toBe(true)
    })

    it("completeWork should move card to done and log audit", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Card", column: "in_progress", position: 0 }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.completeWork("1")
        })
      )

      expect(cards[0].column).toBe("done")
      expect(cards[0].agentStatus).toBe("completed")
      expect(auditLogs.some((l) => l.action === "card.completed")).toBe(true)
    })

    it("skipToBack should move card to end of backlog", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Skip Me", column: "backlog", position: 0 }),
        makeCard({ id: "2", projectId: "p1", title: "Stay", column: "backlog", position: 1 }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.skipToBack("1")
        })
      )

      expect(cards[0].position).toBe(2) // After position 1
      expect(auditLogs.some((l) => l.action === "card.skipped_to_back")).toBe(true)
    })
  })

  describe("resume", () => {
    it("should return card and context when card exists", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "Card", contextSnapshot: "saved context" }),
      ]

      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.resume("1")
        })
      )

      expect(result).not.toBeNull()
      expect(result?.card.title).toBe("Card")
      expect(result?.context).toBe("saved context")
    })

    it("should return null when card does not exist", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.resume("nonexistent")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("createCard", () => {
    it("should create card and log audit", async () => {
      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.createCard("p1", "New Card", "Description")
        })
      )

      expect(card.title).toBe("New Card")
      expect(card.description).toBe("Description")
      expect(card.column).toBe("backlog")
      expect(auditLogs.some((l) => l.action === "card.created")).toBe(true)
    })
  })

  describe("deleteCard", () => {
    it("should delete card and log audit", async () => {
      cards = [
        makeCard({ id: "1", projectId: "p1", title: "To Delete" }),
      ]

      await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          yield* kanban.deleteCard("1")
        })
      )

      expect(cards).toHaveLength(0)
      expect(auditLogs.some((l) => l.action === "card.deleted")).toBe(true)
    })
  })
})
