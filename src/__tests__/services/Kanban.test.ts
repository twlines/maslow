/**
 * Kanban Service Tests
 *
 * Tests the Kanban service layer which wraps AppPersistence with
 * board grouping, card lifecycle management, and audit logging.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { Kanban, KanbanLive } from "../../services/Kanban.js"
import { AppPersistence, AppPersistenceLive } from "../../services/AppPersistence.js"
import { MessageRepository } from "../../services/repositories/MessageRepository.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

const createTempDbPath = () => {
  const tmpDir = os.tmpdir()
  const dbDir = path.join(tmpDir, `maslow-kanban-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  return path.join(dbDir, "sessions.db")
}

const cleanupTempDir = (dbPath: string) => {
  try {
    const dir = path.dirname(dbPath)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Ignore
  }
}

const createTestConfigLayer = (dbPath: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: dbPath },
  } satisfies AppConfig)

const StubMessageRepositoryLayer = Layer.succeed(MessageRepository, {
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
})

describe("Kanban Service", () => {
  let tempDbPath: string

  beforeEach(() => {
    tempDbPath = createTempDbPath()
  })

  afterEach(() => {
    cleanupTempDir(tempDbPath)
  })

  const runWithKanban = <A>(
    effect: Effect.Effect<A, unknown, Kanban | AppPersistence>,
  ): Promise<A> => {
    const configLayer = createTestConfigLayer(tempDbPath)
    const appPersistenceLayer = AppPersistenceLive.pipe(
      Layer.provide(configLayer),
      Layer.provide(StubMessageRepositoryLayer),
    )
    const kanbanLayer = KanbanLive.pipe(
      Layer.provide(appPersistenceLayer),
    )
    const testLayer = Layer.merge(kanbanLayer, appPersistenceLayer)
    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer)),
    )
  }

  // Helper: create a project and return its ID
  const createProject = (name = "Test Project") =>
    Effect.gen(function* () {
      const db = yield* AppPersistence
      const p = yield* db.createProject(name, "")
      return p.id
    })

  // ========================================================================
  // Board operations
  // ========================================================================

  describe("getBoard", () => {
    it("should return empty board for new project", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          return yield* kanban.getBoard(projectId)
        }),
      )

      expect(board.backlog).toHaveLength(0)
      expect(board.in_progress).toHaveLength(0)
      expect(board.done).toHaveLength(0)
    })

    it("should group cards by column", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          yield* kanban.createCard(projectId, "Backlog 1")
          yield* kanban.createCard(projectId, "Backlog 2")
          yield* kanban.createCard(projectId, "WIP", "", "in_progress")
          yield* kanban.createCard(projectId, "Done", "", "done")
          return yield* kanban.getBoard(projectId)
        }),
      )

      expect(board.backlog).toHaveLength(2)
      expect(board.in_progress).toHaveLength(1)
      expect(board.done).toHaveLength(1)
      expect(board.backlog[0].title).toBe("Backlog 1")
      expect(board.in_progress[0].title).toBe("WIP")
    })

    it("should sort cards by position within columns", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          yield* kanban.createCard(projectId, "First")
          yield* kanban.createCard(projectId, "Second")
          yield* kanban.createCard(projectId, "Third")
          return yield* kanban.getBoard(projectId)
        }),
      )

      expect(board.backlog.map((c) => c.title)).toEqual(["First", "Second", "Third"])
    })
  })

  // ========================================================================
  // Card CRUD
  // ========================================================================

  describe("createCard", () => {
    it("should create card and log audit entry", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Audit Test", "desc")
          const audit = yield* db.getAuditLog({ entityType: "kanban_card", entityId: card.id })
          return { card, audit }
        }),
      )

      expect(result.card.title).toBe("Audit Test")
      expect(result.audit.total).toBeGreaterThanOrEqual(1)
      expect(result.audit.items.some((e) => e.action === "card.created")).toBe(true)
    })
  })

  describe("deleteCard", () => {
    it("should delete card and log audit entry", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Delete Me")
          yield* kanban.deleteCard(card.id)
          const deleted = yield* db.getCard(card.id)
          const audit = yield* db.getAuditLog({ entityType: "kanban_card", entityId: card.id })
          return { deleted, audit }
        }),
      )

      expect(result.deleted).toBeNull()
      expect(result.audit.items.some((e) => e.action === "card.deleted")).toBe(true)
    })
  })

  // ========================================================================
  // Card movement
  // ========================================================================

  describe("moveCard", () => {
    it("should move card to target column with correct position", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Mover")
          yield* kanban.moveCard(card.id, "in_progress")
          return yield* kanban.getBoard(projectId)
        }),
      )

      expect(board.backlog).toHaveLength(0)
      expect(board.in_progress).toHaveLength(1)
      expect(board.in_progress[0].title).toBe("Mover")
    })

    it("should append to end of target column", async () => {
      const board = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          yield* kanban.createCard(projectId, "Existing WIP", "", "in_progress")
          const card = yield* kanban.createCard(projectId, "New WIP")
          yield* kanban.moveCard(card.id, "in_progress")
          return yield* kanban.getBoard(projectId)
        }),
      )

      expect(board.in_progress).toHaveLength(2)
      // New card should be after existing one
      expect(board.in_progress[0].title).toBe("Existing WIP")
      expect(board.in_progress[1].title).toBe("New WIP")
    })

    it("should silently no-op for non-existent card", async () => {
      await expect(
        runWithKanban(
          Effect.gen(function* () {
            const kanban = yield* Kanban
            yield* kanban.moveCard("nonexistent", "done")
          }),
        ),
      ).resolves.not.toThrow()
    })

    it("should log audit entry for card moves", async () => {
      const audit = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Audit Move")
          yield* kanban.moveCard(card.id, "done")
          return yield* db.getAuditLog({ entityType: "kanban_card", entityId: card.id })
        }),
      )

      expect(audit.items.some((e) => e.action === "card.moved")).toBe(true)
    })
  })

  // ========================================================================
  // createCardFromConversation
  // ========================================================================

  describe("createCardFromConversation", () => {
    it("should extract first sentence as title", async () => {
      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          return yield* kanban.createCardFromConversation(
            projectId,
            "Fix the login bug. It crashes on Safari when using SSO.",
          )
        }),
      )

      expect(card.title).toBe("Fix the login bug")
      expect(card.description).toBe("Fix the login bug. It crashes on Safari when using SSO.")
      expect(card.column).toBe("backlog")
    })

    it("should truncate long first sentences to 80 chars", async () => {
      const longText = "A".repeat(100) + ". Second sentence."
      const card = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          return yield* kanban.createCardFromConversation(projectId, longText)
        }),
      )

      expect(card.title.length).toBeLessThanOrEqual(80)
      expect(card.title.endsWith("...")).toBe(true)
    })
  })

  // ========================================================================
  // Work queue
  // ========================================================================

  describe("Work queue", () => {
    it("getNext should return first backlog card", async () => {
      const next = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          yield* kanban.createCard(projectId, "First")
          yield* kanban.createCard(projectId, "Second")
          return yield* kanban.getNext(projectId)
        }),
      )

      expect(next).not.toBeNull()
      expect(next!.title).toBe("First")
    })

    it("skipToBack should move card to end and get next", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          const first = yield* kanban.createCard(projectId, "Skip Me")
          yield* kanban.createCard(projectId, "Second")
          yield* kanban.skipToBack(first.id)
          return yield* kanban.getNext(projectId)
        }),
      )

      expect(result!.title).toBe("Second")
    })

    it("saveContext and resume should round-trip context", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Context Card")
          yield* kanban.saveContext(card.id, "my snapshot data", "session-xyz")
          return yield* kanban.resume(card.id)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.card.title).toBe("Context Card")
      expect(result!.context).toBe("my snapshot data")
    })

    it("resume should return null for non-existent card", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          return yield* kanban.resume("nonexistent")
        }),
      )

      expect(result).toBeNull()
    })
  })

  // ========================================================================
  // Card lifecycle (startWork / completeWork)
  // ========================================================================

  describe("Card lifecycle", () => {
    it("startWork should move to in_progress and assign agent", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Start Test")
          yield* kanban.startWork(card.id, "ollama")
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("in_progress")
      expect(result!.assignedAgent).toBe("ollama")
      expect(result!.startedAt).toBeTypeOf("number")
    })

    it("startWork without agent should still move to in_progress", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "No Agent")
          yield* kanban.startWork(card.id)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("in_progress")
      expect(result!.assignedAgent).toBeNull()
    })

    it("completeWork should move to done and set completedAt", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Complete Test")
          yield* kanban.startWork(card.id, "ollama")
          yield* kanban.completeWork(card.id)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("done")
      expect(result!.agentStatus).toBe("completed")
      expect(result!.completedAt).toBeTypeOf("number")
    })

    it("full lifecycle: backlog → startWork → completeWork → done", async () => {
      const boards = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Full Lifecycle")
          const initial = yield* kanban.getBoard(projectId)
          yield* kanban.startWork(card.id, "ollama")
          const working = yield* kanban.getBoard(projectId)
          yield* kanban.completeWork(card.id)
          const completed = yield* kanban.getBoard(projectId)
          return { initial, working, completed }
        }),
      )

      expect(boards.initial.backlog).toHaveLength(1)
      expect(boards.initial.in_progress).toHaveLength(0)
      expect(boards.initial.done).toHaveLength(0)

      expect(boards.working.backlog).toHaveLength(0)
      expect(boards.working.in_progress).toHaveLength(1)
      expect(boards.working.done).toHaveLength(0)

      expect(boards.completed.backlog).toHaveLength(0)
      expect(boards.completed.in_progress).toHaveLength(0)
      expect(boards.completed.done).toHaveLength(1)
    })

    it("assignAgent + updateAgentStatus should track agent state", async () => {
      const result = await runWithKanban(
        Effect.gen(function* () {
          const kanban = yield* Kanban
          const db = yield* AppPersistence
          const projectId = yield* createProject()
          const card = yield* kanban.createCard(projectId, "Agent Track")
          yield* kanban.assignAgent(card.id, "ollama")
          const running = yield* db.getCard(card.id)
          yield* kanban.updateAgentStatus(card.id, "blocked", "Needs clarification")
          const blocked = yield* db.getCard(card.id)
          yield* kanban.updateAgentStatus(card.id, "running")
          const resumed = yield* db.getCard(card.id)
          return { running, blocked, resumed }
        }),
      )

      expect(result.running!.agentStatus).toBe("running")
      expect(result.blocked!.agentStatus).toBe("blocked")
      expect(result.blocked!.blockedReason).toBe("Needs clarification")
      expect(result.resumed!.agentStatus).toBe("running")
    })
  })
})
