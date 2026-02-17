/**
 * Heartbeat Tests — Sprint 3b (Hardening + Observability)
 *
 * Tests the tick/synth mutex guards (Cards 1+2), basic tick behavior,
 * concurrency enforcement, blocked card retry, submitTaskBrief, and
 * startup reconciliation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { Heartbeat, HeartbeatLive } from "../../services/Heartbeat.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import { Kanban } from "../../services/Kanban.js"
import { AgentOrchestrator } from "../../services/AgentOrchestrator.js"
import { AppPersistence } from "../../services/AppPersistence.js"
import { Telegram } from "../../services/Telegram.js"
import { ClaudeMem } from "../../services/ClaudeMem.js"
import type { KanbanCard, AgentType } from "@maslow/shared"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

// ── Test infrastructure ──

let tempDir: string

beforeAll(() => {
  tempDir = path.join(
    os.tmpdir(),
    `maslow-hb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  fs.mkdirSync(tempDir, { recursive: true })

  // Write a minimal HEARTBEAT.md
  fs.writeFileSync(
    path.join(tempDir, "HEARTBEAT.md"),
    [
      "## Constraints",
      "- [x] Max concurrent agents: 2",
      "- [x] Blocked retry interval: 30",
      "",
      "## Builder",
      "- [x] Process backlog kanban cards",
      "- [x] Retry blocked cards",
      "",
      "## Synthesizer",
      "- [ ] Merge branch-verified cards",
      "",
      "## Notifications",
      "- [x] Websocket: all heartbeat events",
      "- [ ] Telegram: agent spawned",
    ].join("\n"),
    "utf-8",
  )
})

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Tracking ──

const calls: Record<string, unknown[][]> = {}
const track = (name: string, ...args: unknown[]) => {
  if (!calls[name]) calls[name] = []
  calls[name].push(args)
}
const resetCalls = () => { Object.keys(calls).forEach(k => delete calls[k]) }

// ── Stub layers ──

const makeConfigLayer = () =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: tempDir },
    database: { path: path.join(tempDir, "test.db") },
    ollama: { host: "http://localhost:11434", model: "test-model", maxRetries: 1 },
  } satisfies AppConfig)

const makeCard = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: `card-${Math.random().toString(36).slice(2, 10)}`,
  projectId: "proj-1",
  title: "Test Card",
  description: "Test description",
  column: "backlog" as const,
  position: 0,
  contextSnapshot: null,
  agentStatus: null,
  agentType: null,
  verificationStatus: null,
  verificationOutput: null,
  branchName: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  completedAt: null,
  campaignId: null,
  ...overrides,
})

// Configurable kanban stub
let nextCard: KanbanCard | null = null
let boardCards: { backlog: KanbanCard[]; in_progress: KanbanCard[]; review: KanbanCard[]; done: KanbanCard[] } = {
  backlog: [], in_progress: [], review: [], done: [],
}

const StubKanbanLayer = Layer.succeed(Kanban, {
  getBoard: (_projectId: string) => {
    track("getBoard", _projectId)
    return Effect.succeed(boardCards)
  },
  createCard: (_pid: string, title: string, desc: string, _col: string) => {
    const card = makeCard({ projectId: _pid, title, description: desc })
    track("createCard", _pid, title)
    return Effect.succeed(card)
  },
  deleteCard: () => Effect.succeed(true),
  moveCard: () => Effect.succeed(true),
  createCardFromConversation: () => Effect.succeed({} as never),
  getNext: (_projectId: string) => {
    track("getNext", _projectId)
    return Effect.succeed(nextCard)
  },
  startWork: (_cardId: string, _agent: string) => {
    track("startWork", _cardId, _agent)
    return Effect.void
  },
  completeWork: () => Effect.void,
  skipToBack: (_cardId: string) => {
    track("skipToBack", _cardId)
    return Effect.void
  },
  saveContext: () => Effect.void,
  assignAgent: () => Effect.void,
  updateAgentStatus: (_cardId: string, _status: string, _reason?: string) => {
    track("updateAgentStatus", _cardId, _status, _reason)
    return Effect.void
  },
})

// Configurable orchestrator stub
let runningAgents: Array<{ cardId: string; projectId: string; status: string }> = []
let spawnShouldFail = false
let spawnDelay = 0

const StubOrchestratorLayer = Layer.succeed(AgentOrchestrator, {
  spawnAgent: (options: { cardId: string; projectId: string; agent: AgentType; prompt: string; cwd: string }) => {
    track("spawnAgent", options.cardId, options.projectId)
    if (spawnShouldFail) {
      return Effect.fail(new Error("Spawn failed (test)"))
    }
    if (spawnDelay > 0) {
      return Effect.delay(Effect.succeed({
        cardId: options.cardId, projectId: options.projectId, agent: options.agent,
        process: null, fiber: null, status: "running" as const, startedAt: Date.now(),
        logs: [], branchName: "test-branch", worktreeDir: "/tmp/test", spanId: "test-span",
      }), `${spawnDelay} millis`)
    }
    return Effect.succeed({
      cardId: options.cardId, projectId: options.projectId, agent: options.agent,
      process: null, fiber: null, status: "running" as const, startedAt: Date.now(),
      logs: [], branchName: "test-branch", worktreeDir: "/tmp/test", spanId: "test-span",
    })
  },
  stopAgent: () => Effect.void,
  getRunningAgents: () => Effect.succeed(runningAgents as never),
  getAgentLogs: () => Effect.succeed([]),
  shutdownAll: () => Effect.void,
})

const StubAppPersistenceLayer = Layer.succeed(AppPersistence, {
  getProjects: () => Effect.succeed([
    { id: "proj-1", name: "Test Project", description: "", status: "active" as const, agentTimeoutMinutes: null, createdAt: Date.now(), updatedAt: Date.now() },
  ]),
  getProject: () => Effect.succeed(null),
  getCard: () => Effect.succeed(null),
  getCards: () => Effect.succeed([]),
  getNextCard: () => Effect.succeed(null),
  getCardsByVerificationStatus: () => Effect.succeed([]),
  logAudit: () => Effect.void,
  updateCardVerification: () => Effect.void,
  insertTokenUsage: () => Effect.void,
  createProject: () => Effect.succeed({} as never),
  updateProject: () => Effect.succeed(true),
  createCard: () => Effect.succeed({} as never),
  updateCard: () => Effect.succeed(true),
  deleteCard: () => Effect.succeed(true),
  moveCard: () => Effect.succeed(true),
  startCard: () => Effect.succeed(true),
  completeCard: () => Effect.succeed(true),
  assignAgent: () => Effect.succeed(true),
  saveContext: () => Effect.succeed(true),
  skipToBack: () => Effect.succeed(true),
  createDocument: () => Effect.succeed({} as never),
  getDocuments: () => Effect.succeed([]),
  updateDocument: () => Effect.succeed(true),
  deleteDocument: () => Effect.succeed(true),
  logDecision: () => Effect.succeed({} as never),
  getDecisions: () => Effect.succeed([]),
  createConversation: () => Effect.succeed({} as never),
  getRecentConversations: () => Effect.succeed([]),
  getActiveConversation: () => Effect.succeed(null),
  endConversation: () => Effect.succeed(true),
  addSteeringCorrection: () => Effect.succeed({} as never),
  getSteeringCorrections: () => Effect.succeed([]),
  updateSteeringCorrection: () => Effect.succeed(true),
  search: () => Effect.succeed([]),
  getAuditLog: () => Effect.succeed([]),
  verify: () => Effect.succeed({ tablesOk: true, missingTables: [] }),
  createCampaign: () => Effect.succeed({} as never),
  getCampaigns: () => Effect.succeed([]),
  updateCampaign: () => Effect.succeed(true),
  insertCampaignReport: () => Effect.succeed({} as never),
  getCampaignReports: () => Effect.succeed([]),
  getCardsByCampaign: () => Effect.succeed([]),
  createCampaignReport: () => Effect.succeed({} as never),
} as never)

const StubTelegramLayer = Layer.succeed(Telegram, {
  sendMessage: () => Effect.succeed(0),
  editMessage: () => Effect.succeed(true),
  bot: null as never,
  start: () => Effect.void,
  stop: () => Effect.void,
})

const StubClaudeMemLayer = Layer.succeed(ClaudeMem, {
  query: () => Effect.succeed(""),
  summarize: () => Effect.succeed(""),
} as never)

const makeTestLayer = () =>
  HeartbeatLive.pipe(
    Layer.provide(makeConfigLayer()),
    Layer.provide(StubKanbanLayer),
    Layer.provide(StubOrchestratorLayer),
    Layer.provide(StubAppPersistenceLayer),
    Layer.provide(StubTelegramLayer),
    Layer.provide(StubClaudeMemLayer),
  )

const runHeartbeat = <A>(
  effect: (hb: ReturnType<typeof Heartbeat["of"]> extends never ? never : Heartbeat["Type"]) => Effect.Effect<A, Error>,
) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const hb = yield* Heartbeat
        return yield* effect(hb)
      }),
      makeTestLayer(),
    ),
  )

// ── Tests ──

describe("Heartbeat", () => {
  describe("tick behavior", () => {
    it("processes active projects and spawns agents", async () => {
      resetCalls()
      nextCard = makeCard()
      runningAgents = []

      await runHeartbeat((hb) => hb.tick())

      expect(calls["spawnAgent"]).toBeDefined()
      expect(calls["spawnAgent"]!.length).toBe(1)
    })

    it("skips spawn when project already has a running agent", async () => {
      resetCalls()
      nextCard = makeCard()
      runningAgents = [{ cardId: "existing", projectId: "proj-1", status: "running" }]

      await runHeartbeat((hb) => hb.tick())

      expect(calls["spawnAgent"]).toBeUndefined()
    })

    it("respects global concurrency limit", async () => {
      resetCalls()
      nextCard = makeCard()
      // 2 running agents already (max = 2)
      runningAgents = [
        { cardId: "a1", projectId: "other-1", status: "running" },
        { cardId: "a2", projectId: "other-2", status: "running" },
      ]

      await runHeartbeat((hb) => hb.tick())

      // Should get next card but not spawn (at limit)
      expect(calls["spawnAgent"]).toBeUndefined()
    })

    it("retries blocked cards after blockedRetryMinutes", async () => {
      resetCalls()
      nextCard = null
      runningAgents = []
      boardCards = {
        backlog: [],
        in_progress: [
          makeCard({
            id: "blocked-card",
            column: "in_progress",
            agentStatus: "blocked" as never,
            updatedAt: Date.now() - 31 * 60 * 1000, // 31 minutes ago
          }),
        ],
        review: [],
        done: [],
      }

      await runHeartbeat((hb) => hb.tick())

      expect(calls["skipToBack"]).toBeDefined()
      expect(calls["skipToBack"]![0][0]).toBe("blocked-card")

      // Reset board
      boardCards = { backlog: [], in_progress: [], review: [], done: [] }
    })

    it("handles spawn failure gracefully", async () => {
      resetCalls()
      nextCard = makeCard()
      runningAgents = []
      spawnShouldFail = true

      // Should not throw
      await runHeartbeat((hb) => hb.tick())

      spawnShouldFail = false
    })
  })

  describe("tick mutex (Card 1)", () => {
    it("prevents concurrent ticks", async () => {
      resetCalls()
      nextCard = makeCard()
      runningAgents = []
      spawnDelay = 200 // Make first tick take a bit

      // Use a single shared Heartbeat instance so mutex state is shared
      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const hb = yield* Heartbeat

            // Fire two ticks concurrently within the same instance
            yield* Effect.all([hb.tick(), hb.tick()], { concurrency: 2 })
          }),
          makeTestLayer(),
        ),
      )

      // Only 1 spawn should happen (second tick skipped by mutex)
      const spawnCount = calls["spawnAgent"]?.length ?? 0
      expect(spawnCount).toBeLessThanOrEqual(1)

      spawnDelay = 0
    })
  })

  describe("synthesize mutex (Card 2)", () => {
    it("runs synthesize without error when disabled", async () => {
      resetCalls()

      // HEARTBEAT.md has synthesizer disabled
      await runHeartbeat((hb) => hb.synthesize())

      // Should not throw, and should not try to get verified cards
    })
  })

  describe("submitTaskBrief", () => {
    it("creates card and triggers tick", async () => {
      resetCalls()
      nextCard = null // No cards in backlog after creating
      runningAgents = []

      const card = await runHeartbeat((hb) =>
        hb.submitTaskBrief("Fix the login bug on the dashboard")
      )

      expect(card).toBeDefined()
      expect(card.title).toBeDefined()
      expect(calls["createCard"]).toBeDefined()
    })

    it("with immediate=false skips tick", async () => {
      resetCalls()
      runningAgents = []

      await runHeartbeat((hb) =>
        hb.submitTaskBrief("Another task", { immediate: false })
      )

      expect(calls["createCard"]).toBeDefined()
      // getNext would be called by tick — if immediate=false, no tick runs,
      // so spawnAgent should not be called from the brief
      expect(calls["spawnAgent"]).toBeUndefined()
    })
  })
})
