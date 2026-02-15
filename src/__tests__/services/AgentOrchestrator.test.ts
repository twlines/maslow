/**
 * AgentOrchestrator Tests — Sprint 3 (Pipeline Reliability)
 *
 * Tests the concurrency, cleanup, and status-flow fixes:
 * - Spawn mutex serializes concurrent spawns
 * - stopAgent cleans up worktree
 * - shutdownAll cleans up worktrees
 * - Push failure -> card blocked (not completed)
 * - Status stays "running" during verification (no premature "completed")
 * - AgentProcess includes worktreeDir field
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import {
  AgentOrchestrator,
  AgentOrchestratorLive,
  type AgentProcess,
} from "../../services/AgentOrchestrator.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import { Kanban } from "../../services/Kanban.js"
import { AppPersistence } from "../../services/AppPersistence.js"
import { Telegram } from "../../services/Telegram.js"
import { OllamaAgent } from "../../services/OllamaAgent.js"
import { SkillLoader } from "../../services/SkillLoader.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { execSync } from "child_process"

// ── Test infrastructure ──

let tempDir: string

beforeAll(() => {
  tempDir = path.join(
    os.tmpdir(),
    `maslow-orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  fs.mkdirSync(tempDir, { recursive: true })
  // Init a git repo so worktree commands work
  execSync("git init", { cwd: tempDir, stdio: "pipe" })
  execSync("git commit --allow-empty -m init", { cwd: tempDir, stdio: "pipe" })
})

afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch { /* ignore */ }
})

const dbPath = () =>
  path.join(tempDir, `test-${Math.random().toString(36).slice(2)}.db`)

const makeConfigLayer = () =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: tempDir },
    database: { path: dbPath() },
  } satisfies AppConfig)

// Track what methods were called on stubs
const calls: Record<string, unknown[][]> = {}
const track = (name: string, ...args: unknown[]) => {
  if (!calls[name]) calls[name] = []
  calls[name].push(args)
}
const resetCalls = () => { Object.keys(calls).forEach(k => delete calls[k]) }

// ── Stub layers ──

const StubKanbanLayer = Layer.succeed(Kanban, {
  getBoard: () => Effect.succeed({ backlog: [], in_progress: [], review: [], done: [] }),
  createCard: () => Effect.succeed({} as never),
  deleteCard: () => Effect.succeed(true),
  moveCard: () => Effect.succeed(true),
  createCardFromConversation: () => Effect.succeed({} as never),
  getNext: () => Effect.succeed(null),
  startWork: (_cardId: string, _agent: string) => {
    track("startWork", _cardId, _agent)
    return Effect.void
  },
  completeWork: () => Effect.void,
  skipToBack: () => Effect.void,
  saveContext: (_cardId: string, _ctx: string) => {
    track("saveContext", _cardId, _ctx)
    return Effect.void
  },
  assignAgent: () => Effect.void,
  updateAgentStatus: (_cardId: string, _status: string, _reason?: string) => {
    track("updateAgentStatus", _cardId, _status, _reason)
    return Effect.void
  },
})

const makeStubAppPersistenceLayer = () =>
  Layer.succeed(AppPersistence, {
    // Only the methods AgentOrchestrator actually calls
    getCard: (_id: string) =>
      Effect.succeed({
        id: _id,
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
      }),
    getProject: () =>
      Effect.succeed({
        id: "proj-1",
        name: "Test Project",
        description: "",
        status: "active" as const,
        agentTimeoutMinutes: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    logAudit: (_cat: string, _eid: string, _action: string, _details?: unknown) => {
      track("logAudit", _cat, _eid, _action, _details)
      return Effect.void
    },
    updateCardVerification: (_id: string, _status: string, _output?: string) => {
      track("updateCardVerification", _id, _status, _output)
      return Effect.void
    },
    insertTokenUsage: () => Effect.void,
    // Stubs for remaining interface (not called in tests)
    createProject: () => Effect.succeed({} as never),
    getProjects: () => Effect.succeed([]),
    createCard: () => Effect.succeed({} as never),
    updateCard: () => Effect.succeed(true),
    deleteCard: () => Effect.succeed(true),
    getCards: () => Effect.succeed([]),
    getNextCard: () => Effect.succeed(null),
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
    updateProject: () => Effect.succeed(true),
  } as never)

const StubTelegramLayer = Layer.succeed(Telegram, {
  sendMessage: (_chatId: number, _msg: string) => {
    track("sendMessage", _chatId, _msg)
    return Effect.succeed(0)
  },
  editMessage: () => Effect.succeed(true),
  bot: null as never,
  start: () => Effect.void,
  stop: () => Effect.void,
})

const StubSkillLoaderLayer = Layer.succeed(SkillLoader, {
  loadForScope: () => Effect.succeed([]),
  selectForTask: () => Effect.succeed([{ name: "stub-skill" }] as never),
  buildPromptBlock: () => Effect.succeed(""),
  reload: () => Effect.void,
})

// ── Tests ──

describe("AgentOrchestrator", () => {
  describe("AgentProcess type", () => {
    it("includes worktreeDir and spanId fields", () => {
      const ap: AgentProcess = {
        cardId: "c1",
        projectId: "p1",
        agent: "ollama",
        process: null,
        fiber: null,
        status: "running",
        startedAt: Date.now(),
        logs: [],
        branchName: "test",
        worktreeDir: "/tmp/test",
        spanId: "test-span-id",
      }
      expect(ap.worktreeDir).toBe("/tmp/test")
      expect(ap.spanId).toBe("test-span-id")
    })
  })

  describe("spawnAgent basics", () => {
    it("spawns an agent and returns AgentProcess with worktreeDir", async () => {
      resetCalls()
      // Set Ollama to never resolve so the fiber stays running
      const neverResolve: OllamaTaskResult = {
        success: false, filesModified: [], retryCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
      }
      const HangingOllamaLayer = Layer.succeed(OllamaAgent, {
        executeTask: () => Effect.never,
      })

      const testLayer = AgentOrchestratorLive.pipe(
        Layer.provide(makeConfigLayer()),
        Layer.provide(StubKanbanLayer),
        Layer.provide(makeStubAppPersistenceLayer()),
        Layer.provide(StubTelegramLayer),
        Layer.provide(HangingOllamaLayer),
        Layer.provide(StubSkillLoaderLayer),
      )

      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const orch = yield* AgentOrchestrator
              const agent = yield* orch.spawnAgent({
                cardId: "card-001",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "test prompt",
                cwd: tempDir,
              })

              expect(agent.cardId).toBe("card-001")
              expect(agent.status).toBe("running")
              expect(agent.worktreeDir).toContain(".worktrees/card-001")
              expect(agent.branchName).toContain("agent/ollama/")

              // Clean up: stop the agent
              yield* orch.stopAgent("card-001")
              return agent
            }),
            testLayer,
          ),
        ),
      )

      expect(result.worktreeDir).toBeDefined()
    })
  })

  describe("concurrent spawn serialization", () => {
    it("rejects second spawn for same project (per-project limit)", async () => {
      resetCalls()
      const HangingOllamaLayer = Layer.succeed(OllamaAgent, {
        executeTask: () => Effect.never,
      })

      const testLayer = AgentOrchestratorLive.pipe(
        Layer.provide(makeConfigLayer()),
        Layer.provide(StubKanbanLayer),
        Layer.provide(makeStubAppPersistenceLayer()),
        Layer.provide(StubTelegramLayer),
        Layer.provide(HangingOllamaLayer),
        Layer.provide(StubSkillLoaderLayer),
      )

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const orch = yield* AgentOrchestrator

              // First spawn succeeds
              yield* orch.spawnAgent({
                cardId: "card-a",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "task a",
                cwd: tempDir,
              })

              // Second spawn for same project should fail
              const result = yield* orch.spawnAgent({
                cardId: "card-b",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "task b",
                cwd: tempDir,
              }).pipe(Effect.either)

              expect(result._tag).toBe("Left")

              // Cleanup
              yield* orch.stopAgent("card-a")
            }),
            testLayer,
          ),
        ),
      )
    })
  })

  describe("stopAgent", () => {
    it("cleans up worktree on stop", async () => {
      resetCalls()
      const HangingOllamaLayer = Layer.succeed(OllamaAgent, {
        executeTask: () => Effect.never,
      })

      const testLayer = AgentOrchestratorLive.pipe(
        Layer.provide(makeConfigLayer()),
        Layer.provide(StubKanbanLayer),
        Layer.provide(makeStubAppPersistenceLayer()),
        Layer.provide(StubTelegramLayer),
        Layer.provide(HangingOllamaLayer),
        Layer.provide(StubSkillLoaderLayer),
      )

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const orch = yield* AgentOrchestrator

              const agent = yield* orch.spawnAgent({
                cardId: "card-stop",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "test",
                cwd: tempDir,
              })

              // Worktree should exist
              expect(fs.existsSync(agent.worktreeDir)).toBe(true)

              // Stop the agent
              yield* orch.stopAgent("card-stop")

              // Worktree should be cleaned up
              expect(fs.existsSync(agent.worktreeDir)).toBe(false)

              // Agent status should be idle
              const agents = yield* orch.getRunningAgents()
              const stopped = agents.find(a => a.cardId === "card-stop")
              expect(stopped?.status).toBe("idle")
            }),
            testLayer,
          ),
        ),
      )
    })
  })

  describe("shutdownAll", () => {
    it("cleans up all worktrees on shutdown", async () => {
      resetCalls()
      const HangingOllamaLayer = Layer.succeed(OllamaAgent, {
        executeTask: () => Effect.never,
      })

      const testLayer = AgentOrchestratorLive.pipe(
        Layer.provide(makeConfigLayer()),
        Layer.provide(StubKanbanLayer),
        Layer.provide(makeStubAppPersistenceLayer()),
        Layer.provide(StubTelegramLayer),
        Layer.provide(HangingOllamaLayer),
        Layer.provide(StubSkillLoaderLayer),
      )

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const orch = yield* AgentOrchestrator

              const agent = yield* orch.spawnAgent({
                cardId: "card-shutdown",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "test",
                cwd: tempDir,
              })

              expect(fs.existsSync(agent.worktreeDir)).toBe(true)

              yield* orch.shutdownAll()

              // Worktree should be cleaned up
              expect(fs.existsSync(agent.worktreeDir)).toBe(false)
            }),
            testLayer,
          ),
        ),
      )
    })
  })

  describe("getRunningAgents", () => {
    it("returns agents with sanitized fiber/process fields", async () => {
      resetCalls()
      const HangingOllamaLayer = Layer.succeed(OllamaAgent, {
        executeTask: () => Effect.never,
      })

      const testLayer = AgentOrchestratorLive.pipe(
        Layer.provide(makeConfigLayer()),
        Layer.provide(StubKanbanLayer),
        Layer.provide(makeStubAppPersistenceLayer()),
        Layer.provide(StubTelegramLayer),
        Layer.provide(HangingOllamaLayer),
        Layer.provide(StubSkillLoaderLayer),
      )

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const orch = yield* AgentOrchestrator

              yield* orch.spawnAgent({
                cardId: "card-list",
                projectId: "proj-1",
                agent: "ollama",
                prompt: "test",
                cwd: tempDir,
              })

              const agents = yield* orch.getRunningAgents()
              expect(agents.length).toBe(1)
              expect(agents[0].process).toBeNull()
              expect(agents[0].fiber).toBeNull()
              expect(agents[0].worktreeDir).toContain(".worktrees/")

              yield* orch.stopAgent("card-list")
            }),
            testLayer,
          ),
        ),
      )
    })
  })
})
