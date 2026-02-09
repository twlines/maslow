/**
 * Unit Tests for Heartbeat Service
 *
 * Tests tick logic (project scanning, agent spawning decisions),
 * synthesizer cycle, task brief submission → card creation,
 * and stuck card reconciliation on startup.
 *
 * Mocks: Kanban, AgentOrchestrator, AppPersistence, Telegram, ClaudeMem, ConfigService
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { Effect, Layer } from "effect"
import { Heartbeat, HeartbeatLive, setHeartbeatBroadcast } from "../../services/Heartbeat.js"
import { Kanban, type KanbanService } from "../../services/Kanban.js"
import { AgentOrchestrator, type AgentOrchestratorService } from "../../services/AgentOrchestrator.js"
import { AppPersistence, type AppKanbanCard, type AppProject } from "../../services/AppPersistence.js"
import { Telegram } from "../../services/Telegram.js"
import { ClaudeMem } from "../../services/ClaudeMem.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import type { AgentProcess } from "../../services/AgentOrchestrator.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeCard = (overrides: Partial<AppKanbanCard> = {}): AppKanbanCard => ({
  id: overrides.id ?? "card-1",
  projectId: overrides.projectId ?? "proj-1",
  title: overrides.title ?? "Test card",
  description: overrides.description ?? "Test description",
  column: overrides.column ?? "backlog",
  labels: overrides.labels ?? [],
  linkedDecisionIds: overrides.linkedDecisionIds ?? [],
  linkedMessageIds: overrides.linkedMessageIds ?? [],
  position: overrides.position ?? 0,
  priority: overrides.priority ?? 0,
  contextSnapshot: overrides.contextSnapshot ?? null,
  lastSessionId: overrides.lastSessionId ?? null,
  assignedAgent: overrides.assignedAgent ?? null,
  agentStatus: overrides.agentStatus ?? null,
  blockedReason: overrides.blockedReason ?? null,
  startedAt: overrides.startedAt ?? null,
  completedAt: overrides.completedAt ?? null,
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
})

const makeProject = (overrides: Partial<AppProject> = {}): AppProject => ({
  id: overrides.id ?? "proj-1",
  name: overrides.name ?? "Test Project",
  description: overrides.description ?? "A test project",
  status: overrides.status ?? "active",
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
})

const makeAgentProcess = (overrides: Partial<AgentProcess> = {}): AgentProcess => ({
  cardId: overrides.cardId ?? "card-1",
  projectId: overrides.projectId ?? "proj-1",
  agent: overrides.agent ?? "claude",
  process: overrides.process ?? null,
  status: overrides.status ?? "running",
  startedAt: overrides.startedAt ?? Date.now(),
  logs: overrides.logs ?? [],
  branchName: overrides.branchName ?? "agent/claude/test-card-1",
})

const testConfig: AppConfig = {
  telegram: { botToken: "test-token", userId: 12345 },
  anthropic: { apiKey: "test-key" },
  workspace: { path: "/tmp/test-workspace" },
  database: { path: ":memory:" },
}

// ---------------------------------------------------------------------------
// Mock layer builders
// ---------------------------------------------------------------------------

interface MockKanbanOverrides {
  getBoard?: KanbanService["getBoard"]
  getNext?: KanbanService["getNext"]
  skipToBack?: KanbanService["skipToBack"]
  createCard?: KanbanService["createCard"]
}

const buildMockKanban = (overrides: MockKanbanOverrides = {}) =>
  Layer.succeed(Kanban, {
    getBoard: overrides.getBoard ?? (() => Effect.succeed({ backlog: [], in_progress: [], done: [] })),
    getNext: overrides.getNext ?? (() => Effect.succeed(null)),
    skipToBack: overrides.skipToBack ?? (() => Effect.void),
    createCard: overrides.createCard ?? ((_pid, title, desc, _col) =>
      Effect.succeed(makeCard({ title, description: desc }))),
    updateCard: () => Effect.void,
    deleteCard: () => Effect.void,
    moveCard: () => Effect.void,
    createCardFromConversation: (_pid, text) =>
      Effect.succeed(makeCard({ title: text.slice(0, 80), description: text })),
    saveContext: () => Effect.void,
    resume: () => Effect.succeed(null),
    assignAgent: () => Effect.void,
    updateAgentStatus: () => Effect.void,
    startWork: () => Effect.void,
    completeWork: () => Effect.void,
  } satisfies KanbanService)

interface MockOrchestratorOverrides {
  spawnAgent?: AgentOrchestratorService["spawnAgent"]
  getRunningAgents?: AgentOrchestratorService["getRunningAgents"]
}

const buildMockOrchestrator = (overrides: MockOrchestratorOverrides = {}) =>
  Layer.succeed(AgentOrchestrator, {
    spawnAgent: overrides.spawnAgent ?? ((opts) =>
      Effect.succeed(makeAgentProcess({ cardId: opts.cardId, projectId: opts.projectId }))),
    getRunningAgents: overrides.getRunningAgents ?? (() => Effect.succeed([])),
    stopAgent: () => Effect.void,
    getAgentLogs: () => Effect.succeed([]),
    shutdownAll: () => Effect.void,
  } satisfies AgentOrchestratorService)

// Minimal AppPersistence mock — only getProjects is used by Heartbeat directly
const buildMockAppPersistence = (projects: AppProject[] = [makeProject()]) =>
  Layer.succeed(AppPersistence, {
    getProjects: () => Effect.succeed(projects),
    // Heartbeat doesn't call these directly, but the type requires them
    getProject: () => Effect.succeed(null),
    createProject: () => Effect.succeed(makeProject()),
    updateProject: () => Effect.void,
    deleteProject: () => Effect.void,
    getMessages: () => Effect.succeed([]),
    saveMessage: () => Effect.void,
    getCards: () => Effect.succeed([]),
    getCard: () => Effect.succeed(null),
    createCard: (_pid, title, desc) => Effect.succeed(makeCard({ title, description: desc })),
    updateCard: () => Effect.void,
    deleteCard: () => Effect.void,
    moveCard: () => Effect.void,
    getNextCard: () => Effect.succeed(null),
    skipCardToBack: () => Effect.void,
    saveCardContext: () => Effect.void,
    assignCardAgent: () => Effect.void,
    updateCardAgentStatus: () => Effect.void,
    startCard: () => Effect.void,
    completeCard: () => Effect.void,
    getDecisions: () => Effect.succeed([]),
    createDecision: () => Effect.succeed(undefined as never),
    getDocuments: () => Effect.succeed([]),
    getDocument: () => Effect.succeed(null),
    upsertDocument: () => Effect.void,
    deleteDocument: () => Effect.void,
    logAudit: () => Effect.void,
    getAuditLog: () => Effect.succeed([]),
    getConversations: () => Effect.succeed([]),
    upsertConversation: () => Effect.void,
    insertTokenUsage: () => Effect.void,
    getTokenUsage: () => Effect.succeed([]),
  } as unknown as AppPersistence["Type"])

const buildMockTelegram = () =>
  Layer.succeed(Telegram, {
    sendMessage: () => Effect.succeed(undefined as never),
    start: () => Effect.void,
    stop: () => Effect.void,
    onMessage: () => Effect.void,
    onCallbackQuery: () => Effect.void,
    editMessage: () => Effect.succeed(undefined as never),
    deleteMessage: () => Effect.void,
    sendPhoto: () => Effect.succeed(undefined as never),
    sendVoice: () => Effect.succeed(undefined as never),
  } as unknown as Telegram["Type"])

const buildMockClaudeMem = () =>
  Layer.succeed(ClaudeMem, {
    query: () => Effect.succeed(""),
    summarize: () => Effect.succeed(""),
  } as unknown as ClaudeMem["Type"])

const buildMockConfig = (config: AppConfig = testConfig) =>
  Layer.succeed(ConfigService, config)

// ---------------------------------------------------------------------------
// Build the full Heartbeat layer from mocks
// ---------------------------------------------------------------------------

interface BuildLayerOptions {
  projects?: AppProject[]
  kanban?: MockKanbanOverrides
  orchestrator?: MockOrchestratorOverrides
  config?: AppConfig
}

const buildHeartbeatLayer = (opts: BuildLayerOptions = {}) => {
  const deps = Layer.mergeAll(
    buildMockConfig(opts.config),
    buildMockKanban(opts.kanban),
    buildMockOrchestrator(opts.orchestrator),
    buildMockAppPersistence(opts.projects),
    buildMockTelegram(),
    buildMockClaudeMem(),
  )
  return HeartbeatLive.pipe(Layer.provide(deps))
}

const runWithHeartbeat = <A>(
  effect: Effect.Effect<A, unknown, Heartbeat>,
  opts: BuildLayerOptions = {},
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, buildHeartbeatLayer(opts)))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Heartbeat Service", () => {
  let broadcasts: Record<string, unknown>[]

  beforeEach(() => {
    broadcasts = []
    setHeartbeatBroadcast((msg) => broadcasts.push(msg))
  })

  // =========================================================================
  // tick() — builder tick logic
  // =========================================================================
  describe("tick()", () => {
    it("should broadcast idle when no projects exist", async () => {
      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        { projects: [] },
      )

      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg).toBeDefined()
      expect(tickMsg!.projectsScanned).toBe(0)
      expect(tickMsg!.agentsRunning).toBe(0)

      const idleMsg = broadcasts.find(b => b.type === "heartbeat.idle")
      expect(idleMsg).toBeDefined()
    })

    it("should skip archived/paused projects", async () => {
      const projects = [
        makeProject({ id: "p1", status: "archived" }),
        makeProject({ id: "p2", status: "paused" }),
      ]

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        { projects },
      )

      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg!.projectsScanned).toBe(0)
    })

    it("should spawn agent for backlog card", async () => {
      const spawnSpy = vi.fn(() => Effect.succeed(makeAgentProcess()))
      const nextCard = makeCard({ id: "card-work", title: "Do work" })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          kanban: {
            getNext: () => Effect.succeed(nextCard),
          },
          orchestrator: {
            spawnAgent: spawnSpy,
          },
        },
      )

      expect(spawnSpy).toHaveBeenCalledOnce()
      const callArgs = spawnSpy.mock.calls[0][0]
      expect(callArgs.cardId).toBe("card-work")
      expect(callArgs.agent).toBe("claude")

      const spawnedMsg = broadcasts.find(b => b.type === "heartbeat.spawned")
      expect(spawnedMsg).toBeDefined()
      expect(spawnedMsg!.cardId).toBe("card-work")
    })

    it("should skip project that already has a running agent", async () => {
      const spawnSpy = vi.fn(() => Effect.succeed(makeAgentProcess()))

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          kanban: {
            getNext: () => Effect.succeed(makeCard()),
          },
          orchestrator: {
            spawnAgent: spawnSpy,
            getRunningAgents: () => Effect.succeed([
              makeAgentProcess({ projectId: "proj-1", status: "running" }),
            ]),
          },
        },
      )

      expect(spawnSpy).not.toHaveBeenCalled()
    })

    it("should enforce global concurrency limit of 3", async () => {
      const spawnSpy = vi.fn(() => Effect.succeed(makeAgentProcess()))

      const projects = [
        makeProject({ id: "p1" }),
        makeProject({ id: "p2" }),
        makeProject({ id: "p3" }),
        makeProject({ id: "p4" }),
      ]

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          projects,
          kanban: {
            getNext: () => Effect.succeed(makeCard()),
          },
          orchestrator: {
            spawnAgent: spawnSpy,
          },
        },
      )

      // MAX_CONCURRENT_AGENTS = 3, so only 3 of 4 projects get agents
      expect(spawnSpy).toHaveBeenCalledTimes(3)
    })

    it("should move blocked cards back to backlog after 30 minutes", async () => {
      const skipSpy = vi.fn(() => Effect.void)
      const blockedCard = makeCard({
        id: "blocked-1",
        column: "in_progress",
        agentStatus: "blocked",
        updatedAt: Date.now() - 31 * 60 * 1000, // 31 min ago
      })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          kanban: {
            getBoard: () => Effect.succeed({
              backlog: [],
              in_progress: [blockedCard],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      expect(skipSpy).toHaveBeenCalledWith("blocked-1")

      const retryMsg = broadcasts.find(b => b.type === "heartbeat.retry")
      expect(retryMsg).toBeDefined()
      expect(retryMsg!.cardId).toBe("blocked-1")
      expect(retryMsg!.previousStatus).toBe("blocked")
    })

    it("should NOT move recently blocked cards", async () => {
      const skipSpy = vi.fn(() => Effect.void)
      const blockedCard = makeCard({
        id: "blocked-recent",
        column: "in_progress",
        agentStatus: "blocked",
        updatedAt: Date.now() - 5 * 60 * 1000, // 5 min ago — under 30-min threshold
      })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          kanban: {
            getBoard: () => Effect.succeed({
              backlog: [],
              in_progress: [blockedCard],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      expect(skipSpy).not.toHaveBeenCalled()
    })

    it("should handle spawn failure gracefully and continue", async () => {
      const projects = [
        makeProject({ id: "p1" }),
        makeProject({ id: "p2" }),
      ]

      let callCount = 0
      const spawnSpy = vi.fn(() => {
        callCount++
        if (callCount === 1) {
          return Effect.fail(new Error("spawn failed"))
        }
        return Effect.succeed(makeAgentProcess({ projectId: "p2" }))
      })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          projects,
          kanban: {
            getNext: () => Effect.succeed(makeCard()),
          },
          orchestrator: {
            spawnAgent: spawnSpy,
          },
        },
      )

      // Both projects attempted
      expect(spawnSpy).toHaveBeenCalledTimes(2)

      const errorMsg = broadcasts.find(b => b.type === "heartbeat.error")
      expect(errorMsg).toBeDefined()
      expect((errorMsg!.message as string)).toContain("spawn failed")

      // Tick summary still sent
      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg).toBeDefined()
    })

    it("should broadcast tick summary after scanning all projects", async () => {
      const projects = [
        makeProject({ id: "p1" }),
        makeProject({ id: "p2" }),
      ]

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.tick()
        }),
        {
          projects,
          kanban: {
            getNext: () => Effect.succeed(makeCard()),
          },
        },
      )

      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg).toBeDefined()
      expect(tickMsg!.projectsScanned).toBe(2)
      expect(tickMsg!.agentsRunning).toBe(2)
    })
  })

  // =========================================================================
  // submitTaskBrief() — card creation from brief
  // =========================================================================
  describe("submitTaskBrief()", () => {
    it("should create card in backlog from brief text", async () => {
      const createSpy = vi.fn((_pid: string, title: string, desc: string, _col: string) =>
        Effect.succeed(makeCard({ title, description: desc })))

      const result = await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("Build login page. It should support OAuth.", {
            immediate: false,
          })
        }),
        {
          kanban: { createCard: createSpy },
        },
      )

      expect(createSpy).toHaveBeenCalledOnce()
      const [pid, title, desc, col] = createSpy.mock.calls[0]
      expect(pid).toBe("proj-1") // Falls back to first active project
      expect(title).toBe("Build login page")
      expect(desc).toBe("Build login page. It should support OAuth.")
      expect(col).toBe("backlog")

      expect(result.title).toBe("Build login page")
    })

    it("should match project by name in brief text", async () => {
      const projects = [
        makeProject({ id: "p-mobile", name: "Mobile App" }),
        makeProject({ id: "p-server", name: "Server" }),
      ]

      const createSpy = vi.fn((_pid: string, title: string, desc: string) =>
        Effect.succeed(makeCard({ projectId: _pid, title, description: desc })))

      const result = await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("Fix Server deployment config", {
            immediate: false,
          })
        }),
        {
          projects,
          kanban: { createCard: createSpy },
        },
      )

      const [pid] = createSpy.mock.calls[0]
      expect(pid).toBe("p-server")
      expect(result.projectId).toBe("p-server")
    })

    it("should use explicit projectId when provided", async () => {
      const createSpy = vi.fn((_pid: string, title: string, desc: string) =>
        Effect.succeed(makeCard({ projectId: _pid, title, description: desc })))

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("Some task", {
            projectId: "explicit-project",
            immediate: false,
          })
        }),
        {
          kanban: { createCard: createSpy },
        },
      )

      const [pid] = createSpy.mock.calls[0]
      expect(pid).toBe("explicit-project")
    })

    it("should fail when no active projects exist", async () => {
      const result = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const hb = yield* Heartbeat
            return yield* hb.submitTaskBrief("Some task", { immediate: false })
          }),
          buildHeartbeatLayer({ projects: [] }),
        ),
      )

      expect(result._tag).toBe("Failure")
    })

    it("should truncate long titles to 80 characters", async () => {
      const longBrief = "A".repeat(100) + ". Second sentence."
      const createSpy = vi.fn((_pid: string, title: string, desc: string) =>
        Effect.succeed(makeCard({ title, description: desc })))

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief(longBrief, { immediate: false })
        }),
        {
          kanban: { createCard: createSpy },
        },
      )

      const [, title] = createSpy.mock.calls[0]
      expect(title.length).toBeLessThanOrEqual(80)
      expect(title).toContain("...")
    })

    it("should broadcast cardCreated event", async () => {
      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("New feature idea", { immediate: false })
        }),
      )

      const created = broadcasts.find(b => b.type === "heartbeat.cardCreated")
      expect(created).toBeDefined()
      expect(created!.source).toBe("submitTaskBrief")
      expect(created!.title).toBe("New feature idea")
    })

    it("should trigger immediate tick by default", async () => {
      // When immediate is not false, tick() runs after card creation.
      // We verify by checking for heartbeat.tick broadcast.
      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("Immediate task")
        }),
      )

      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg).toBeDefined()
    })

    it("should NOT trigger tick when immediate=false", async () => {
      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          return yield* hb.submitTaskBrief("No tick task", { immediate: false })
        }),
      )

      const tickMsg = broadcasts.find(b => b.type === "heartbeat.tick")
      expect(tickMsg).toBeUndefined()
    })
  })

  // =========================================================================
  // start() — stuck card reconciliation on startup
  // =========================================================================
  describe("start() — startup reconciliation", () => {
    it("should reset stuck 'running' cards to backlog", async () => {
      const skipSpy = vi.fn(() => Effect.void)

      const stuckCard = makeCard({
        id: "stuck-running",
        column: "in_progress",
        agentStatus: "running",
      })

      // start() calls tick() after reconciliation — we need getNext etc.
      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.start()
          // Stop immediately to avoid cron running
          yield* hb.stop()
        }),
        {
          kanban: {
            getBoard: () => Effect.succeed({
              backlog: [],
              in_progress: [stuckCard],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      // skipToBack called during reconciliation (and possibly during tick for blocked cards)
      expect(skipSpy).toHaveBeenCalledWith("stuck-running")
    })

    it("should reset stuck 'blocked' cards to backlog", async () => {
      const skipSpy = vi.fn(() => Effect.void)

      const blockedCard = makeCard({
        id: "stuck-blocked",
        column: "in_progress",
        agentStatus: "blocked",
      })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.start()
          yield* hb.stop()
        }),
        {
          kanban: {
            getBoard: () => Effect.succeed({
              backlog: [],
              in_progress: [blockedCard],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      expect(skipSpy).toHaveBeenCalledWith("stuck-blocked")
    })

    it("should NOT reset idle or completed in-progress cards", async () => {
      const skipSpy = vi.fn(() => Effect.void)

      const idleCard = makeCard({
        id: "idle-card",
        column: "in_progress",
        agentStatus: "idle",
      })
      const completedCard = makeCard({
        id: "completed-card",
        column: "in_progress",
        agentStatus: "completed",
      })

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.start()
          yield* hb.stop()
        }),
        {
          kanban: {
            getBoard: () => Effect.succeed({
              backlog: [],
              in_progress: [idleCard, completedCard],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      // skipToBack should NOT be called for idle/completed cards during reconciliation
      // (it may be called during the immediate tick for blocked cards, but these aren't blocked)
      expect(skipSpy).not.toHaveBeenCalled()
    })

    it("should handle multiple projects during reconciliation", async () => {
      const skipSpy = vi.fn(() => Effect.void)

      const projects = [
        makeProject({ id: "p1" }),
        makeProject({ id: "p2" }),
      ]

      const stuckCards: Record<string, AppKanbanCard[]> = {
        "p1": [makeCard({ id: "stuck-p1", column: "in_progress", agentStatus: "running" })],
        "p2": [makeCard({ id: "stuck-p2", column: "in_progress", agentStatus: "blocked" })],
      }

      await runWithHeartbeat(
        Effect.gen(function* () {
          const hb = yield* Heartbeat
          yield* hb.start()
          yield* hb.stop()
        }),
        {
          projects,
          kanban: {
            getBoard: (projectId) => Effect.succeed({
              backlog: [],
              in_progress: stuckCards[projectId] ?? [],
              done: [],
            }),
            skipToBack: skipSpy,
          },
        },
      )

      expect(skipSpy).toHaveBeenCalledWith("stuck-p1")
      expect(skipSpy).toHaveBeenCalledWith("stuck-p2")
    })
  })

  // =========================================================================
  // stop()
  // =========================================================================
  describe("stop()", () => {
    it("should complete without error", async () => {
      await expect(
        runWithHeartbeat(
          Effect.gen(function* () {
            const hb = yield* Heartbeat
            yield* hb.stop()
          }),
        ),
      ).resolves.not.toThrow()
    })
  })
})
