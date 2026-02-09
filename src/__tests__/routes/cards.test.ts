import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  createMockRes,
  createMockDb,
  createMockKanban,
  makeCard,
} from "./route-test-utils.js"
import {
  handleGetCards,
  handleCreateCard,
  handleUpdateCard,
  handleDeleteCard,
  handleGetNextCard,
  handleSaveCardContext,
  handleSkipCard,
  handleAssignCard,
  handleStartCard,
  handleCompleteCard,
  handleResumeCard,
} from "../../routes/cards.js"

describe("card routes", () => {
  describe("GET /api/projects/:id/cards", () => {
    it("returns empty board", async () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleGetCards(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({
        ok: true,
        data: { backlog: [], in_progress: [], done: [] },
      })
    })

    it("returns board with cards in columns", async () => {
      const board = {
        backlog: [makeCard({ id: "c1", column: "backlog" })],
        in_progress: [makeCard({ id: "c2", column: "in_progress" })],
        done: [],
      }
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          getBoard: () => Effect.succeed(board),
        }),
      }
      handleGetCards(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: board })
    })
  })

  describe("POST /api/projects/:id/cards", () => {
    it("creates a card", async () => {
      const card = makeCard({ id: "new-card", title: "New Card" })
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          createCard: () => Effect.succeed(card),
        }),
      }
      handleCreateCard(deps, res, "proj-1", { title: "New Card" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(res._mock.body).toEqual({ ok: true, data: card })
    })

    it("passes description and column through", async () => {
      let capturedDesc: string | undefined
      let capturedCol: string | undefined
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          createCard: (_pid, _title, desc, col) => {
            capturedDesc = desc
            capturedCol = col
            return Effect.succeed(makeCard())
          },
        }),
      }
      handleCreateCard(deps, res, "proj-1", {
        title: "Card",
        description: "Desc",
        column: "in_progress",
      })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(capturedDesc).toBe("Desc")
      expect(capturedCol).toBe("in_progress")
    })

    it("returns 400 when title is missing", () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleCreateCard(deps, res, "proj-1", {})
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "title is required" })
    })
  })

  describe("PUT /api/projects/:id/cards/:cardId", () => {
    it("updates a card", async () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleUpdateCard(deps, res, "card-1", { title: "Updated" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({
        ok: true,
        data: { id: "card-1", title: "Updated" },
      })
    })

    it("moves card when column is provided", async () => {
      let movedTo = ""
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          moveCard: (_id, column) => {
            movedTo = column
            return Effect.succeed(undefined)
          },
        }),
      }
      handleUpdateCard(deps, res, "card-1", { column: "done" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(movedTo).toBe("done")
      expect(res._mock.status).toBe(200)
    })

    it("returns 404 when card not found during optimistic lock check", async () => {
      const res = createMockRes()
      const deps = {
        db: createMockDb({
          getCard: () => Effect.succeed(null),
        }),
        kanban: createMockKanban(),
      }
      handleUpdateCard(deps, res, "card-1", { if_updated_at: 1000 })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(404)
      expect(res._mock.body).toEqual({ ok: false, error: "Card not found" })
    })

    it("returns 409 when card was modified by another client", async () => {
      const res = createMockRes()
      const deps = {
        db: createMockDb({
          getCard: () => Effect.succeed(makeCard({ updatedAt: 3000 })),
        }),
        kanban: createMockKanban(),
      }
      handleUpdateCard(deps, res, "card-1", { if_updated_at: 2000 })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(409)
      expect(res._mock.body).toEqual({
        ok: false,
        error: "Card was modified by another client",
        currentUpdatedAt: 3000,
      })
    })

    it("proceeds when optimistic lock matches", async () => {
      const res = createMockRes()
      const deps = {
        db: createMockDb({
          getCard: () => Effect.succeed(makeCard({ updatedAt: 2000 })),
        }),
        kanban: createMockKanban(),
      }
      handleUpdateCard(deps, res, "card-1", { if_updated_at: 2000, title: "OK" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
    })
  })

  describe("DELETE /api/projects/:id/cards/:cardId", () => {
    it("deletes a card", async () => {
      let deletedId = ""
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          deleteCard: (id) => {
            deletedId = id
            return Effect.succeed(undefined)
          },
        }),
      }
      handleDeleteCard(deps, res, "card-99")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(deletedId).toBe("card-99")
      expect(res._mock.body).toEqual({ ok: true, data: { deleted: true } })
    })
  })

  describe("GET /api/projects/:id/cards/next", () => {
    it("returns null when no cards in queue", async () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleGetNextCard(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: null })
    })

    it("returns next card", async () => {
      const card = makeCard({ id: "next-card" })
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          getNext: () => Effect.succeed(card),
        }),
      }
      handleGetNextCard(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.body).toEqual({ ok: true, data: card })
    })
  })

  describe("POST /api/projects/:id/cards/:cardId/context", () => {
    it("saves card context", async () => {
      let savedSnapshot = ""
      let savedSessionId: string | undefined
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          saveContext: (_id, snapshot, sessionId) => {
            savedSnapshot = snapshot
            savedSessionId = sessionId
            return Effect.succeed(undefined)
          },
        }),
      }
      handleSaveCardContext(deps, res, "card-1", { snapshot: "ctx data", sessionId: "sess-1" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(savedSnapshot).toBe("ctx data")
      expect(savedSessionId).toBe("sess-1")
    })

    it("returns 400 when snapshot is missing", () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleSaveCardContext(deps, res, "card-1", {})
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "snapshot is required" })
    })
  })

  describe("POST /api/projects/:id/cards/:cardId/skip", () => {
    it("skips card to back of queue", async () => {
      let skippedId = ""
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          skipToBack: (id) => {
            skippedId = id
            return Effect.succeed(undefined)
          },
        }),
      }
      handleSkipCard(deps, res, "card-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(skippedId).toBe("card-1")
    })
  })

  describe("POST /api/projects/:id/cards/:cardId/assign", () => {
    it("assigns agent to card", async () => {
      let assignedAgent = ""
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          assignAgent: (_id, agent) => {
            assignedAgent = agent
            return Effect.succeed(undefined)
          },
        }),
      }
      handleAssignCard(deps, res, "card-1", { agent: "claude" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(assignedAgent).toBe("claude")
    })

    it("returns 400 when agent is missing", () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleAssignCard(deps, res, "card-1", {})
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "agent is required" })
    })
  })

  describe("POST /api/projects/:id/cards/:cardId/start", () => {
    it("starts work on card", async () => {
      let startedAgent: string | undefined
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          startWork: (_id, agent) => {
            startedAgent = agent
            return Effect.succeed(undefined)
          },
        }),
      }
      handleStartCard(deps, res, "card-1", { agent: "codex" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(startedAgent).toBe("codex")
    })
  })

  describe("POST /api/projects/:id/cards/:cardId/complete", () => {
    it("completes card work", async () => {
      let completedId = ""
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          completeWork: (id) => {
            completedId = id
            return Effect.succeed(undefined)
          },
        }),
      }
      handleCompleteCard(deps, res, "card-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(completedId).toBe("card-1")
    })
  })

  describe("GET /api/projects/:id/cards/:cardId/resume", () => {
    it("returns null when no context saved", async () => {
      const res = createMockRes()
      const deps = { db: createMockDb(), kanban: createMockKanban() }
      handleResumeCard(deps, res, "card-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: null })
    })

    it("returns card and context when available", async () => {
      const card = makeCard({ id: "card-1" })
      const result = { card, context: "saved context data" }
      const res = createMockRes()
      const deps = {
        db: createMockDb(),
        kanban: createMockKanban({
          resume: () => Effect.succeed(result),
        }),
      }
      handleResumeCard(deps, res, "card-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: result })
    })
  })
})
