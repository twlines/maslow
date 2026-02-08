/**
 * AgentOrchestrator Tests
 *
 * Tests spawn concurrency limits (max 3 global, 1 per project),
 * timeout handling, worktree lifecycle, and prompt assembly.
 * Mocks: child_process, Kanban, AppPersistence, SteeringEngine, Telegram, ConfigService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer, Exit } from "effect"
import { EventEmitter } from "events"
import {
  AgentOrchestrator,
  AgentOrchestratorLive,
} from "../../services/AgentOrchestrator.js"
import { Kanban } from "../../services/Kanban.js"
import {
  AppPersistence,
  type AppKanbanCard,
  type AppProject,
} from "../../services/AppPersistence.js"
import { SteeringEngine } from "../../services/SteeringEngine.js"
import { Telegram } from "../../services/Telegram.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import { Stream } from "effect"

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

// Track calls to child_process functions
interface ExecSyncCall {
  command: string
  options?: Record<string, unknown>
}

let execSyncCalls: ExecSyncCall[] = []
let spawnCalls: Array<{ cmd: string; args: string[]; options?: Record<string, unknown> }> = []
let mockChildProcesses: MockChildProcess[] = []

class MockChildProcess extends EventEmitter {
  stdin = { end: vi.fn() }
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  pid = Math.floor(Math.random() * 10000)

  kill(signal?: string) {
    this.killed = true
    // Emit close on next tick to simulate async behavior
    setTimeout(() => this.emit("close", signal === "SIGKILL" ? 137 : 0), 10)
  }
}

vi.mock("child_process", () => ({
  spawn: (cmd: string, args: string[], options?: Record<string, unknown>) => {
    spawnCalls.push({ cmd, args, options })
    const child = new MockChildProcess()
    mockChildProcesses.push(child)
    return child
  },
  execSync: (command: string, options?: Record<string, unknown>) => {
    execSyncCalls.push({ command, options })
    // Simulate success for git worktree commands
    if (command.includes("git worktree add")) return Buffer.from("")
    if (command.includes("git worktree remove")) return Buffer.from("")
    if (command.includes("gh auth status")) return Buffer.from("")
    if (command.includes("git push")) return Buffer.from("")
    if (command.includes("gh pr create")) return Buffer.from("")
    return Buffer.from("")
  },
}))

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

const makeCard = (overrides: Partial<AppKanbanCard> = {}): AppKanbanCard => ({
  id: "card-1",
  projectId: "proj-1",
  title: "Test Card",
  description: "Test description",
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

const makeProject = (overrides: Partial<AppProject> = {}): AppProject => ({
  id: "proj-1",
  name: "Test Project",
  description: "A test project",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

// ---------------------------------------------------------------------------
// Mock call trackers
// ---------------------------------------------------------------------------

interface MockCalls {
  startWork: Array<{ cardId: string; agent?: string }>
  completeWork: string[]
  saveContext: Array<{ id: string; snapshot: string }>
  updateAgentStatus: Array<{ id: string; status: string; reason?: string }>
  logAudit: Array<{ entityType: string; entityId: string; action: string }>
  sendMessage: Array<{ chatId: number; text: string }>
  insertTokenUsage: Array<Record<string, unknown>>
}

let calls: MockCalls

const resetMocks = () => {
  execSyncCalls = []
  spawnCalls = []
  mockChildProcesses = []
  calls = {
    startWork: [],
    completeWork: [],
    saveContext: [],
    updateAgentStatus: [],
    logAudit: [],
    sendMessage: [],
    insertTokenUsage: [],
  }
}

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

const createMockLayers = (opts?: {
  card?: AppKanbanCard | null
  project?: AppProject | null
  decisions?: Array<{ title: string; reasoning: string; tradeoffs: string }>
  projectDocs?: Array<{ type: string; title: string; content: string }>
  steeringBlock?: string
}) => {
  const configLayer = Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/workspace" },
    database: { path: ":memory:" },
  } satisfies AppConfig)

  const kanbanLayer = Layer.succeed(Kanban, {
    getBoard: () =>
      Effect.succeed({ backlog: [], in_progress: [], done: [] }),
    createCard: () => Effect.succeed(makeCard()),
    updateCard: () => Effect.void,
    deleteCard: () => Effect.void,
    moveCard: () => Effect.void,
    createCardFromConversation: () => Effect.succeed(makeCard()),
    getNext: () => Effect.succeed(null),
    skipToBack: () => Effect.void,
    saveContext: (id, snapshot) => {
      calls.saveContext.push({ id, snapshot })
      return Effect.void
    },
    resume: () => Effect.succeed(null),
    assignAgent: () => Effect.void,
    updateAgentStatus: (id, status, reason) => {
      calls.updateAgentStatus.push({ id, status, reason })
      return Effect.void
    },
    startWork: (id, agent) => {
      calls.startWork.push({ cardId: id, agent })
      return Effect.void
    },
    completeWork: (id) => {
      calls.completeWork.push(id)
      return Effect.void
    },
  })

  const appPersistenceLayer = Layer.succeed(AppPersistence, {
    // Projects
    getProjects: () => Effect.succeed([]),
    getProject: () =>
      Effect.succeed(opts?.project !== undefined ? opts.project : makeProject()),
    createProject: () => Effect.succeed(makeProject()),
    updateProject: () => Effect.void,

    // Project Documents
    getProjectDocuments: () =>
      Effect.succeed(
        (opts?.projectDocs ?? []).map((d, i) => ({
          id: `doc-${i}`,
          projectId: "proj-1",
          type: d.type as "brief",
          title: d.title,
          content: d.content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }))
      ),
    getProjectDocument: () => Effect.succeed(null),
    createProjectDocument: () =>
      Effect.succeed({
        id: "doc-new",
        projectId: "proj-1",
        type: "brief" as const,
        title: "",
        content: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    updateProjectDocument: () => Effect.void,

    // Cards
    getCards: () => Effect.succeed([]),
    getCard: () =>
      Effect.succeed(opts?.card !== undefined ? opts.card : makeCard()),
    createCard: () => Effect.succeed(makeCard()),
    updateCard: () => Effect.void,
    deleteCard: () => Effect.void,
    moveCard: () => Effect.void,

    // Work queue
    getNextCard: () => Effect.succeed(null),
    saveCardContext: () => Effect.void,
    assignCardAgent: () => Effect.void,
    updateCardAgentStatus: () => Effect.void,
    startCard: () => Effect.void,
    completeCard: () => Effect.void,
    skipCardToBack: () => Effect.void,

    // Messages
    saveMessage: () => Effect.void,
    getMessages: () => Effect.succeed([]),

    // Conversations
    getActiveConversation: () => Effect.succeed(null),
    createConversation: () =>
      Effect.succeed({
        id: "conv-1",
        projectId: null,
        claudeSessionId: "",
        status: "active" as const,
        contextUsagePercent: 0,
        summary: null,
        messageCount: 0,
        firstMessageAt: Date.now(),
        lastMessageAt: Date.now(),
      }),
    updateConversationSession: () => Effect.void,
    updateConversationContext: () => Effect.void,
    archiveConversation: () => Effect.void,
    getRecentConversations: () => Effect.succeed([]),
    incrementMessageCount: () => Effect.void,

    // Steering
    addCorrection: () =>
      Effect.succeed({
        id: "corr-1",
        correction: "",
        domain: "code-pattern" as const,
        source: "explicit" as const,
        context: null,
        projectId: null,
        active: true,
        createdAt: Date.now(),
      }),
    getCorrections: () => Effect.succeed([]),
    deactivateCorrection: () => Effect.void,
    reactivateCorrection: () => Effect.void,
    deleteCorrection: () => Effect.void,

    // Audit
    logAudit: (entityType, entityId, action) => {
      calls.logAudit.push({ entityType, entityId, action })
      return Effect.void
    },

    // Token usage
    insertTokenUsage: (usage) => {
      calls.insertTokenUsage.push(usage)
      return Effect.succeed({
        id: "tok-1",
        ...(usage as Record<string, unknown>),
      } as any)
    },

    // Decisions
    getDecisions: () =>
      Effect.succeed(
        (opts?.decisions ?? []).map((d, i) => ({
          id: `dec-${i}`,
          projectId: "proj-1",
          title: d.title,
          description: "",
          alternatives: [],
          reasoning: d.reasoning,
          tradeoffs: d.tradeoffs,
          createdAt: Date.now(),
        }))
      ),
    getDecision: () => Effect.succeed(null),
    createDecision: () =>
      Effect.succeed({
        id: "dec-new",
        projectId: "proj-1",
        title: "",
        description: "",
        alternatives: [],
        reasoning: "",
        tradeoffs: "",
        createdAt: Date.now(),
      }),
    updateDecision: () => Effect.void,

    // Usage
    getUsageSummary: () =>
      Effect.succeed({
        total: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        byProject: [],
        recentMessages: [],
      }),
  })

  const steeringLayer = Layer.succeed(SteeringEngine, {
    capture: () =>
      Effect.succeed({
        id: "s-1",
        correction: "",
        domain: "code-pattern" as const,
        source: "explicit" as const,
        context: null,
        projectId: null,
        active: true,
        createdAt: Date.now(),
      }),
    query: () => Effect.succeed([]),
    deactivate: () => Effect.void,
    reactivate: () => Effect.void,
    remove: () => Effect.void,
    buildPromptBlock: () =>
      Effect.succeed(opts?.steeringBlock ?? ""),
  })

  const telegramLayer = Layer.succeed(Telegram, {
    messages: Stream.empty,
    sendMessage: (chatId, text) => {
      calls.sendMessage.push({ chatId, text })
      return Effect.succeed({ message_id: 100 } as any)
    },
    sendTyping: () => Effect.void,
    editMessage: () => Effect.void,
    getFileBuffer: () => Effect.succeed(Buffer.from("")),
    sendVoiceNote: () => Effect.succeed({ message_id: 101 } as any),
    sendRecordingVoice: () => Effect.void,
    start: () => Effect.void,
    stop: () => Effect.void,
  })

  return Layer.mergeAll(
    configLayer,
    kanbanLayer,
    appPersistenceLayer,
    steeringLayer,
    telegramLayer
  )
}

const runOrchestrator = <A>(
  effect: Effect.Effect<A, unknown, AgentOrchestrator>,
  layerOpts?: Parameters<typeof createMockLayers>[0]
): Promise<A> => {
  const deps = createMockLayers(layerOpts)
  const layer = AgentOrchestratorLive.pipe(Layer.provide(deps))
  return Effect.runPromise(Effect.provide(effect, layer))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentOrchestrator", () => {
  beforeEach(() => {
    resetMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // 1. Spawn Concurrency Limits
  // =========================================================================
  describe("spawn concurrency limits", () => {
    it("should spawn an agent successfully", async () => {
      const result = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build the feature",
            cwd: "/workspace",
          })
        })
      )

      expect(result.status).toBe("running")
      expect(result.cardId).toBe("card-1")
      expect(result.agent).toBe("claude")
      expect(result.branchName).toContain("agent/claude/")

      // Should create git worktree
      expect(
        execSyncCalls.some((c) => c.command.includes("git worktree add"))
      ).toBe(true)

      // Should mark card as started
      expect(calls.startWork).toHaveLength(1)
      expect(calls.startWork[0].cardId).toBe("card-1")

      // Should spawn the claude process
      expect(spawnCalls).toHaveLength(1)
      expect(spawnCalls[0].cmd).toBe("claude")

      // Should log audit
      expect(
        calls.logAudit.some((a) => a.action === "agent.spawned")
      ).toBe(true)
    })

    it("should reject when max concurrent agents (3) reached", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator

            // Spawn 3 agents (one per project to avoid per-project limit)
            yield* orch.spawnAgent({
              cardId: "card-1",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
            yield* orch.spawnAgent({
              cardId: "card-2",
              projectId: "proj-2",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
            yield* orch.spawnAgent({
              cardId: "card-3",
              projectId: "proj-3",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })

            // 4th should fail
            return yield* orch.spawnAgent({
              cardId: "card-4",
              projectId: "proj-4",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
          }),
          AgentOrchestratorLive.pipe(
            Layer.provide(
              createMockLayers({
                card: makeCard(),
                project: makeProject(),
              })
            )
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause
        // The error message should mention max concurrent
        const errorStr = String(error)
        expect(errorStr).toContain("Max concurrent")
      }
    })

    it("should reject when project already has a running agent", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator

            // Spawn first agent on proj-1
            yield* orch.spawnAgent({
              cardId: "card-1",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })

            // Try second agent on same project — should fail
            return yield* orch.spawnAgent({
              cardId: "card-2",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
          }),
          AgentOrchestratorLive.pipe(
            Layer.provide(
              createMockLayers({
                card: makeCard(),
                project: makeProject(),
              })
            )
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const errorStr = String(exit.cause)
        expect(errorStr).toContain("already has a running agent")
      }
    })

    it("should reject when card already has a running agent", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator

            // Spawn agent on card-1
            yield* orch.spawnAgent({
              cardId: "card-1",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })

            // Try same card again — should fail
            return yield* orch.spawnAgent({
              cardId: "card-1",
              projectId: "proj-2",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
          }),
          AgentOrchestratorLive.pipe(
            Layer.provide(
              createMockLayers({
                card: makeCard(),
                project: makeProject(),
              })
            )
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const errorStr = String(exit.cause)
        expect(errorStr).toContain("already has a running agent")
      }
    })

    it("should reject when card is not found", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator
            return yield* orch.spawnAgent({
              cardId: "nonexistent",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
          }),
          AgentOrchestratorLive.pipe(
            Layer.provide(createMockLayers({ card: null }))
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  // =========================================================================
  // 2. Worktree Lifecycle
  // =========================================================================
  describe("worktree lifecycle", () => {
    it("should create git worktree with correct branch name", async () => {
      const result = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.spawnAgent({
            cardId: "abcd1234-long-id",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })
        })
      )

      // Branch should be agent/{type}/{slug}-{cardId.slice(0,8)}
      expect(result.branchName).toContain("agent/claude/")
      expect(result.branchName).toContain("abcd1234")

      // Should call git worktree add
      const worktreeCall = execSyncCalls.find((c) =>
        c.command.includes("git worktree add")
      )
      expect(worktreeCall).toBeDefined()
      expect(worktreeCall!.command).toContain(".worktrees/abcd1234")
    })

    it("should fall back to existing branch when worktree creation fails", async () => {
      // Make the first execSync call fail (git worktree add -b)
      let callCount = 0
      vi.mocked(await import("child_process")).execSync = vi.fn(
        (command: string, options?: Record<string, unknown>) => {
          callCount++
          execSyncCalls.push({ command, options })
          if (callCount === 1 && command.includes("git worktree add -b")) {
            throw new Error("branch already exists")
          }
          return Buffer.from("")
        }
      ) as any

      const result = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })
        })
      )

      // Should still succeed
      expect(result.status).toBe("running")
      // Should have called worktree add twice (first -b, then without -b)
      const worktreeCalls = execSyncCalls.filter((c) =>
        c.command.includes("git worktree add")
      )
      expect(worktreeCalls.length).toBe(2)
    })

    it("should spawn agent in worktree directory", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        })
      )

      // spawn should be called with worktree cwd
      expect(spawnCalls[0].options?.cwd).toContain(".worktrees/")
    })

    it("should strip ANTHROPIC_API_KEY from spawned process env", async () => {
      // Set the key in current process env temporarily
      const originalKey = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = "sk-test-key"

      try {
        await runOrchestrator(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator
            yield* orch.spawnAgent({
              cardId: "card-1",
              projectId: "proj-1",
              agent: "claude",
              prompt: "p",
              cwd: "/workspace",
            })
          })
        )

        const spawnEnv = spawnCalls[0].options?.env as Record<string, string> | undefined
        expect(spawnEnv?.ANTHROPIC_API_KEY).toBeUndefined()
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey
        } else {
          delete process.env.ANTHROPIC_API_KEY
        }
      }
    })
  })

  // =========================================================================
  // 3. Agent Command Building
  // =========================================================================
  describe("agent command building", () => {
    it("should build correct claude command", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })
        })
      )

      expect(spawnCalls[0].cmd).toBe("claude")
      expect(spawnCalls[0].args).toContain("-p")
      expect(spawnCalls[0].args).toContain("--verbose")
      expect(spawnCalls[0].args).toContain("stream-json")
      expect(spawnCalls[0].args).toContain("bypassPermissions")
      expect(spawnCalls[0].args).toContain("50")
    })

    it("should build correct codex command", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "codex",
            prompt: "p",
            cwd: "/workspace",
          })
        })
      )

      expect(spawnCalls[0].cmd).toBe("codex")
      expect(spawnCalls[0].args).toContain("--approval-mode")
      expect(spawnCalls[0].args).toContain("full-auto")
    })

    it("should build correct gemini command", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "gemini",
            prompt: "p",
            cwd: "/workspace",
          })
        })
      )

      expect(spawnCalls[0].cmd).toBe("gemini")
      expect(spawnCalls[0].args).toContain("-y")
    })
  })

  // =========================================================================
  // 4. Prompt Assembly
  // =========================================================================
  describe("prompt assembly", () => {
    it("should include identity section in prompt", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        })
      )

      // The last arg to claude CLI is the prompt
      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("autonomous build agent")
      expect(prompt).toContain("CLAUDE.md")
    })

    it("should include card title and description in prompt", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        }),
        {
          card: makeCard({
            title: "Implement Auth System",
            description: "Build JWT authentication",
          }),
        }
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("Implement Auth System")
      expect(prompt).toContain("Build JWT authentication")
    })

    it("should include deep research protocol in prompt", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        })
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("Deep Research Protocol")
      expect(prompt).toContain("Pass 1: Forward Trace")
      expect(prompt).toContain("Pass 2: Inventory Audit")
      expect(prompt).toContain("Pass 3: Interface Contract Validation")
    })

    it("should include completion checklist in prompt", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        })
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("verification-prompt.md")
      expect(prompt).toContain("Do NOT push")
    })

    it("should include project context when available", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        }),
        {
          project: makeProject({
            name: "Maslow AI",
            description: "Personal AI assistant",
          }),
        }
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("Maslow AI")
      expect(prompt).toContain("Personal AI assistant")
    })

    it("should include steering corrections when present", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Build feature",
            cwd: "/workspace",
          })
        }),
        {
          steeringBlock: "## Steering Corrections\n\n- Always use double quotes",
        }
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("Steering Corrections")
      expect(prompt).toContain("Always use double quotes")
    })

    it("should include previous context snapshot when card was previously worked on", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "Continue feature",
            cwd: "/workspace",
          })
        }),
        {
          card: makeCard({
            contextSnapshot: "Previously implemented login page, auth middleware pending",
          }),
        }
      )

      const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1]
      expect(prompt).toContain("Previous Context")
      expect(prompt).toContain("login page")
    })
  })

  // =========================================================================
  // 5. Agent Lifecycle
  // =========================================================================
  describe("agent lifecycle", () => {
    it("should track running agents via getRunningAgents", async () => {
      const agents = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator

          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })

          return yield* orch.getRunningAgents()
        })
      )

      expect(agents).toHaveLength(1)
      expect(agents[0].cardId).toBe("card-1")
      expect(agents[0].process).toBeNull() // Serialized — no process object
    })

    it("should return logs via getAgentLogs", async () => {
      const logs = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator

          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })

          // Simulate stdout data
          const child = mockChildProcesses[0]
          child.stdout.emit("data", Buffer.from("line 1\nline 2\n"))

          return yield* orch.getAgentLogs("card-1")
        })
      )

      expect(logs.length).toBeGreaterThanOrEqual(2)
      expect(logs.some((l) => l.includes("line 1"))).toBe(true)
      expect(logs.some((l) => l.includes("line 2"))).toBe(true)
    })

    it("should return empty logs for unknown card", async () => {
      const logs = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.getAgentLogs("nonexistent")
        })
      )

      expect(logs).toHaveLength(0)
    })

    it("should stop a running agent", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator

          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })

          yield* orch.stopAgent("card-1")
        })
      )

      // Should save context before stopping
      expect(calls.saveContext.length).toBeGreaterThanOrEqual(1)
      // Should update agent status to idle
      expect(
        calls.updateAgentStatus.some((u) => u.status === "idle")
      ).toBe(true)
    })

    it("should fail when stopping nonexistent agent", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const orch = yield* AgentOrchestrator
            yield* orch.stopAgent("nonexistent")
          }),
          AgentOrchestratorLive.pipe(Layer.provide(createMockLayers()))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  // =========================================================================
  // 6. Shutdown
  // =========================================================================
  describe("shutdownAll", () => {
    it("should handle shutdown with no running agents", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          yield* orch.shutdownAll()
        })
      )

      // Should not error
    })

    it("should shutdown running agents gracefully", async () => {
      await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator

          yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })

          // Simulate process close on SIGTERM
          const child = mockChildProcesses[0]
          const originalKill = child.kill.bind(child)
          child.kill = (signal?: string) => {
            originalKill(signal)
            // Immediately emit close
            child.emit("close", 0)
            return true
          }

          yield* orch.shutdownAll()
        })
      )

      // Should save context for killed agents
      expect(calls.saveContext.length).toBeGreaterThanOrEqual(1)
    })
  })

  // =========================================================================
  // 7. Branch Naming
  // =========================================================================
  describe("branch naming", () => {
    it("should slugify card title correctly", async () => {
      const result = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })
        }),
        {
          card: makeCard({ title: "Fix Auth Bug (Critical!)" }),
        }
      )

      // Should slugify: lowercase, replace non-alphanumeric, strip leading/trailing dashes
      expect(result.branchName).toBe("agent/claude/fix-auth-bug-critical-card-1")
    })

    it("should truncate long titles in branch names", async () => {
      const result = await runOrchestrator(
        Effect.gen(function* () {
          const orch = yield* AgentOrchestrator
          return yield* orch.spawnAgent({
            cardId: "card-1",
            projectId: "proj-1",
            agent: "claude",
            prompt: "p",
            cwd: "/workspace",
          })
        }),
        {
          card: makeCard({
            title: "This is a very long card title that should be truncated because branch names have length limits",
          }),
        }
      )

      // Slug is max 50 chars, plus "agent/claude/" prefix and "-{cardId.slice(0,8)}"
      // Total branch name should be reasonable length
      expect(result.branchName.length).toBeLessThan(80)
    })
  })
})
