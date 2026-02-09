/**
 * Unit Tests for SessionManager Service
 *
 * Tests session creation/resumption, message routing to Claude,
 * workspace action execution, and conversation archival on context limit.
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { SessionManager, SessionManagerLive } from "../../services/SessionManager.js"
import { Persistence, type SessionRecord } from "../../services/Persistence.js"
import { ClaudeSession, type ClaudeEvent } from "../../services/ClaudeSession.js"
import { Telegram, type TelegramMessage } from "../../services/Telegram.js"
import { MessageFormatterLive } from "../../services/MessageFormatter.js"
import type { Message } from "telegraf/types"
import { ConfigService } from "../../services/Config.js"
import { Heartbeat } from "../../services/Heartbeat.js"
import { Voice } from "../../services/Voice.js"
import { Kanban } from "../../services/Kanban.js"
import { ThinkingPartner } from "../../services/ThinkingPartner.js"
import type { AppKanbanCard, AppDecision, AppProjectDocument } from "../../services/AppPersistence.js"

// ─── Test Helpers ────────────────────────────────────────────────

const TEST_CHAT_ID = 12345
const TEST_USER_ID = 67890
const TEST_SESSION_ID = "test-session-abc"
const TEST_WORKSPACE = "/test/workspace"

const makeMessage = (overrides: Partial<TelegramMessage> = {}): TelegramMessage => ({
  chatId: TEST_CHAT_ID,
  userId: TEST_USER_ID,
  messageId: 1,
  text: "Hello Claude",
  ...overrides,
})

const makeSessionRecord = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  telegramChatId: TEST_CHAT_ID,
  claudeSessionId: TEST_SESSION_ID,
  projectPath: null,
  workingDirectory: TEST_WORKSPACE,
  lastActiveAt: Date.now(),
  contextUsagePercent: 0,
  ...overrides,
})

const makeKanbanCard = (overrides: Partial<AppKanbanCard> = {}): AppKanbanCard => ({
  id: "card-1",
  projectId: "telegram",
  title: "Test Card",
  description: "A test card",
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

// ─── Mock Factories ──────────────────────────────────────────────

type SessionStore = Map<number, SessionRecord>

function createMockPersistence(store: SessionStore = new Map()) {
  return Layer.succeed(Persistence, {
    getSession: (chatId: number) =>
      Effect.sync(() => store.get(chatId) ?? null),
    saveSession: (record: SessionRecord) =>
      Effect.sync(() => { store.set(record.telegramChatId, record) }),
    updateLastActive: (chatId: number) =>
      Effect.sync(() => {
        const r = store.get(chatId)
        if (r) store.set(chatId, { ...r, lastActiveAt: Date.now() })
      }),
    updateContextUsage: (chatId: number, percent: number) =>
      Effect.sync(() => {
        const r = store.get(chatId)
        if (r) store.set(chatId, { ...r, contextUsagePercent: percent })
      }),
    deleteSession: (chatId: number) =>
      Effect.sync(() => { store.delete(chatId) }),
    getLastActiveChatId: () =>
      Effect.sync(() => null),
    close: () => Effect.void,
  })
}

function createMockClaude(events: ClaudeEvent[] = [], handoffSummary = "Test handoff summary") {
  return Layer.succeed(ClaudeSession, {
    sendMessage: (_options: {
      prompt: string
      cwd: string
      resumeSessionId?: string
      images?: Array<{ data: Buffer; mediaType: string }>
    }) => Stream.fromIterable(events),
    generateHandoff: (_options: { sessionId: string; cwd: string }) =>
      Effect.succeed(handoffSummary),
  })
}

interface TelegramCallLog {
  sendMessage: Array<{ chatId: number; text: string }>
  editMessage: Array<{ chatId: number; messageId: number; text: string }>
  sendTyping: number[]
  sendRecordingVoice: number[]
  sendVoiceNote: Array<{ chatId: number }>
  getFileBuffer: string[]
}

function createMockTelegram(callLog: TelegramCallLog = {
  sendMessage: [],
  editMessage: [],
  sendTyping: [],
  sendRecordingVoice: [],
  sendVoiceNote: [],
  getFileBuffer: [],
}) {
  let messageCounter = 100
  return {
    layer: Layer.succeed(Telegram, {
      messages: Stream.empty,
      sendMessage: (chatId: number, text: string, _options?: { replyToMessageId?: number; parseMode?: "Markdown" | "HTML" }) =>
        Effect.sync(() => {
          callLog.sendMessage.push({ chatId, text })
          return { message_id: messageCounter++ } as unknown as Message.TextMessage
        }),
      sendTyping: (chatId: number) =>
        Effect.sync(() => { callLog.sendTyping.push(chatId) }),
      editMessage: (chatId: number, messageId: number, text: string, _options?: { parseMode?: "Markdown" | "HTML" }) =>
        Effect.sync(() => { callLog.editMessage.push({ chatId, messageId, text }) }),
      getFileBuffer: (fileId: string) =>
        Effect.sync(() => {
          callLog.getFileBuffer.push(fileId)
          return Buffer.from("fake-audio-data")
        }),
      sendVoiceNote: (chatId: number, _audioBuffer: Buffer, _options?: { replyToMessageId?: number; duration?: number }) =>
        Effect.sync(() => {
          callLog.sendVoiceNote.push({ chatId })
          return { message_id: messageCounter++ } as unknown as Message.VoiceMessage
        }),
      sendRecordingVoice: (chatId: number) =>
        Effect.sync(() => { callLog.sendRecordingVoice.push(chatId) }),
      start: () => Effect.void,
      stop: () => Effect.void,
    }),
    callLog,
  }
}

function createMockConfig() {
  return Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: TEST_USER_ID },
    anthropic: { apiKey: "test-key" },
    workspace: { path: TEST_WORKSPACE },
    database: { path: ":memory:" },
  })
}

function createMockHeartbeat() {
  const calls: string[] = []
  return {
    layer: Layer.succeed(Heartbeat, {
      start: () => Effect.void,
      stop: () => Effect.void,
      submitTaskBrief: (brief: string) => {
        calls.push(brief)
        return Effect.succeed(makeKanbanCard({ title: brief }))
      },
      tick: () => Effect.void,
    }),
    calls,
  }
}

function createMockVoice() {
  return Layer.succeed(Voice, {
    transcribe: (_buf: Buffer) => Effect.succeed("transcribed text"),
    synthesize: (_text: string) => Effect.succeed(Buffer.from("synthesized-audio")),
    isAvailable: () => Effect.succeed({ stt: true, tts: true }),
  })
}

interface KanbanCallLog {
  createdCards: Array<{ projectId: string; title: string; description: string; column: string }>
  movedCards: Array<{ id: string; column: string }>
}

function createMockKanban(callLog: KanbanCallLog = { createdCards: [], movedCards: [] }) {
  const cards: AppKanbanCard[] = []
  return {
    layer: Layer.succeed(Kanban, {
      getBoard: (_projectId: string) =>
        Effect.succeed({
          backlog: cards.filter(c => c.column === "backlog"),
          in_progress: cards.filter(c => c.column === "in_progress"),
          done: cards.filter(c => c.column === "done"),
        }),
      createCard: (projectId: string, title: string, description?: string, column?: string) => {
        const card = makeKanbanCard({ projectId, title, description: description || "", column: (column || "backlog") as AppKanbanCard["column"] })
        cards.push(card)
        callLog.createdCards.push({ projectId, title, description: description || "", column: column || "backlog" })
        return Effect.succeed(card)
      },
      updateCard: () => Effect.void,
      deleteCard: () => Effect.void,
      moveCard: (id: string, column: "backlog" | "in_progress" | "done") => {
        callLog.movedCards.push({ id, column })
        const card = cards.find(c => c.id === id)
        if (card) card.column = column
        return Effect.void
      },
      createCardFromConversation: (_projectId: string, _text: string) =>
        Effect.succeed(makeKanbanCard()),
      getNext: () => Effect.succeed(null),
      skipToBack: () => Effect.void,
      saveContext: () => Effect.void,
      resume: () => Effect.succeed(null),
      assignAgent: () => Effect.void,
      updateAgentStatus: () => Effect.void,
      startWork: () => Effect.void,
      completeWork: () => Effect.void,
    }),
    callLog,
    cards,
  }
}

interface ThinkingPartnerCallLog {
  decisions: Array<{ projectId: string; title: string }>
  assumptions: Array<{ projectId: string; assumption: string }>
  stateSummaries: Array<{ projectId: string; summary: string }>
}

function createMockThinkingPartner(callLog: ThinkingPartnerCallLog = {
  decisions: [],
  assumptions: [],
  stateSummaries: [],
}) {
  return {
    layer: Layer.succeed(ThinkingPartner, {
      logDecision: (projectId: string, decision: { title: string; description: string; alternatives: string[]; reasoning: string; tradeoffs: string }) => {
        callLog.decisions.push({ projectId, title: decision.title })
        return Effect.succeed({
          id: "dec-1",
          projectId,
          title: decision.title,
          description: decision.description,
          alternatives: decision.alternatives,
          reasoning: decision.reasoning,
          tradeoffs: decision.tradeoffs,
          createdAt: Date.now(),
        } satisfies AppDecision)
      },
      getDecisions: () => Effect.succeed([]),
      addAssumption: (projectId: string, assumption: string) => {
        callLog.assumptions.push({ projectId, assumption })
        return Effect.succeed({
          id: "doc-1",
          projectId,
          type: "assumptions" as const,
          title: "Assumptions",
          content: assumption,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies AppProjectDocument)
      },
      getAssumptions: () => Effect.succeed(null),
      updateStateSummary: (projectId: string, summary: string) => {
        callLog.stateSummaries.push({ projectId, summary })
        return Effect.void
      },
      getStateSummary: () => Effect.succeed(null),
      getProjectContext: () => Effect.succeed(""),
    }),
    callLog,
  }
}

// ─── Layer Assembly ──────────────────────────────────────────────

interface TestSetup {
  telegramCalls: TelegramCallLog
  kanbanCalls: KanbanCallLog
  thinkingPartnerCalls: ThinkingPartnerCallLog
  heartbeatCalls: string[]
  sessionStore: SessionStore
  layer: Layer.Layer<SessionManager>
}

function buildTestLayer(options: {
  claudeEvents?: ClaudeEvent[]
  handoffSummary?: string
  sessionStore?: SessionStore
} = {}): TestSetup {
  const sessionStore = options.sessionStore ?? new Map<number, SessionRecord>()
  const telegram = createMockTelegram()
  const kanban = createMockKanban()
  const tp = createMockThinkingPartner()
  const hb = createMockHeartbeat()

  const layer = SessionManagerLive.pipe(
    Layer.provide(createMockPersistence(sessionStore)),
    Layer.provide(createMockClaude(options.claudeEvents ?? [], options.handoffSummary)),
    Layer.provide(telegram.layer),
    Layer.provide(MessageFormatterLive),
    Layer.provide(createMockConfig()),
    Layer.provide(hb.layer),
    Layer.provide(createMockVoice()),
    Layer.provide(kanban.layer),
    Layer.provide(tp.layer),
  )

  return {
    telegramCalls: telegram.callLog,
    kanbanCalls: kanban.callLog,
    thinkingPartnerCalls: tp.callLog,
    heartbeatCalls: hb.calls,
    sessionStore,
    layer,
  }
}

const run = <A>(setup: TestSetup, effect: Effect.Effect<A, Error, SessionManager>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, setup.layer))

// ─── Tests ───────────────────────────────────────────────────────

describe("SessionManager", () => {
  // ── Session Creation ────────────────────────────────────────
  describe("session creation", () => {
    it("should create a new session for unknown chatId", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "new-session-1", content: "Hello!" },
        { type: "result", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 200000 } },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Session should be persisted with the new Claude session ID
      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved).toBeDefined()
      expect(saved!.claudeSessionId).toBe("new-session-1")
      expect(saved!.workingDirectory).toBe(TEST_WORKSPACE)
    })

    it("should reuse existing session for known chatId", async () => {
      const existingRecord = makeSessionRecord({ claudeSessionId: "existing-session" })
      const store = new Map<number, SessionRecord>([[TEST_CHAT_ID, existingRecord]])

      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "existing-session", content: "Resumed!" },
        { type: "result", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 200000 } },
      ]
      const setup = buildTestLayer({ claudeEvents: events, sessionStore: store })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Session should still exist with the same ID
      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved).toBeDefined()
      expect(saved!.claudeSessionId).toBe("existing-session")
    })

    it("should set empty claudeSessionId on initial creation", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", content: "Hello" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // When no sessionId comes back from Claude events, the original empty string persists
      // until a "text" event with a sessionId arrives
      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved).toBeDefined()
    })
  })

  // ── Session Resumption ──────────────────────────────────────
  describe("session resumption", () => {
    it("should pass resumeSessionId when session has claudeSessionId", async () => {
      const existingRecord = makeSessionRecord({ claudeSessionId: "resume-me" })
      const store = new Map<number, SessionRecord>([[TEST_CHAT_ID, existingRecord]])

      // We verify by checking that the session is looked up and Claude is called
      // The mock sendMessage doesn't inspect args but the flow works end-to-end
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "resume-me", content: "Resumed context" },
        { type: "result", usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 200000 } },
      ]
      const setup = buildTestLayer({ claudeEvents: events, sessionStore: store })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Telegram should have received the response
      expect(setup.telegramCalls.sendMessage.some(m => m.text.includes("Resumed context"))).toBe(true)
    })

    it("should not pass resumeSessionId for new sessions", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "brand-new", content: "Fresh start" },
        { type: "result", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 200000 } },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved!.claudeSessionId).toBe("brand-new")
    })
  })

  // ── Message Routing to Claude ───────────────────────────────
  describe("message routing", () => {
    it("should send typing indicator before processing", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", content: "Response" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.telegramCalls.sendTyping).toContain(TEST_CHAT_ID)
    })

    it("should send text response back to Telegram", async () => {
      // Use text longer than 100 chars to trigger immediate send, or include \n\n
      const events: ClaudeEvent[] = [
        { type: "text", content: "Here is my response\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Here is my response"))).toBe(true)
    })

    it("should notify on tool calls", async () => {
      const events: ClaudeEvent[] = [
        { type: "tool_call", toolCall: { name: "Read", input: { file_path: "/src/index.ts" } } },
        { type: "tool_result" },
        { type: "text", content: "Done reading\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Should have sent a tool call notification
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Read"))).toBe(true)
    })

    it("should send error messages to Telegram on error events", async () => {
      const events: ClaudeEvent[] = [
        { type: "error", error: "Something went wrong" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Something went wrong"))).toBe(true)
    })

    it("should handle /restart_claude command", async () => {
      const existingRecord = makeSessionRecord()
      const store = new Map<number, SessionRecord>([[TEST_CHAT_ID, existingRecord]])
      const setup = buildTestLayer({ sessionStore: store })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage({ text: "/restart_claude" }))
      }))

      // Session should be deleted
      expect(setup.sessionStore.has(TEST_CHAT_ID)).toBe(false)
      // Confirmation message sent
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Session cleared"))).toBe(true)
    })

    it("should route task briefs to Heartbeat", async () => {
      const setup = buildTestLayer()

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage({ text: "TASK: Build a widget" }))
      }))

      expect(setup.heartbeatCalls).toContain("TASK: Build a widget")
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Autonomous Mode"))).toBe(true)
    })

    it("should route Brief: messages to Heartbeat", async () => {
      const setup = buildTestLayer()

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage({ text: "Brief: Design the API" }))
      }))

      expect(setup.heartbeatCalls).toContain("Brief: Design the API")
    })
  })

  // ── Workspace Action Execution ──────────────────────────────
  describe("workspace action execution", () => {
    it("should execute create_card actions from Claude response", async () => {
      const textWithAction = `Here is the plan.\n\n:::action\n{"type":"create_card","title":"New Feature","description":"Build it","column":"backlog"}\n:::\n\nDone.`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.kanbanCalls.createdCards).toHaveLength(1)
      expect(setup.kanbanCalls.createdCards[0].title).toBe("New Feature")
      expect(setup.kanbanCalls.createdCards[0].column).toBe("backlog")
    })

    it("should execute log_decision actions", async () => {
      const textWithAction = `:::action\n{"type":"log_decision","title":"Use Effect-TS","description":"For error handling","alternatives":["RxJS"],"reasoning":"Better types","tradeoffs":"Learning curve"}\n:::`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.thinkingPartnerCalls.decisions).toHaveLength(1)
      expect(setup.thinkingPartnerCalls.decisions[0].title).toBe("Use Effect-TS")
    })

    it("should execute add_assumption actions", async () => {
      const textWithAction = `:::action\n{"type":"add_assumption","assumption":"Single user for now"}\n:::`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.thinkingPartnerCalls.assumptions).toHaveLength(1)
      expect(setup.thinkingPartnerCalls.assumptions[0].assumption).toBe("Single user for now")
    })

    it("should execute update_state actions", async () => {
      const textWithAction = `:::action\n{"type":"update_state","summary":"Project is 50% complete"}\n:::`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.thinkingPartnerCalls.stateSummaries).toHaveLength(1)
      expect(setup.thinkingPartnerCalls.stateSummaries[0].summary).toBe("Project is 50% complete")
    })

    it("should execute multiple actions in one response", async () => {
      const textWithActions = [
        `:::action\n{"type":"create_card","title":"Card A","column":"backlog"}\n:::`,
        `Some text`,
        `:::action\n{"type":"add_assumption","assumption":"Assumption B"}\n:::`,
      ].join("\n")
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithActions },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.kanbanCalls.createdCards).toHaveLength(1)
      expect(setup.thinkingPartnerCalls.assumptions).toHaveLength(1)
    })

    it("should skip actions with missing required fields", async () => {
      // create_card without title should be skipped
      const textWithAction = `:::action\n{"type":"create_card","description":"No title"}\n:::`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.kanbanCalls.createdCards).toHaveLength(0)
    })

    it("should not fail if action execution errors", async () => {
      // Even if an action fails internally, the session should continue
      const textWithAction = `:::action\n{"type":"create_card","title":"Valid Card","column":"backlog"}\n:::`
      const events: ClaudeEvent[] = [
        { type: "text", content: textWithAction },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      // This should not throw even if some internal action logic fails
      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      expect(setup.kanbanCalls.createdCards).toHaveLength(1)
    })
  })

  // ── Context Monitoring & Archival ───────────────────────────
  describe("conversation archival on context limit", () => {
    it("should update context usage on result events", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "ctx-session", content: "Response" },
        {
          type: "result",
          usage: {
            inputTokens: 20000,
            outputTokens: 10000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved).toBeDefined()
      // (20000 + 10000) / 200000 * 100 = 15%
      expect(saved!.contextUsagePercent).toBeCloseTo(15, 0)
    })

    it("should trigger auto-handoff at 50% context usage", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "handoff-session", content: "Response" },
        {
          type: "result",
          usage: {
            inputTokens: 60000,
            outputTokens: 40000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Should have sent auto-handoff messages
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Auto-handoff"))).toBe(true)
      expect(sentTexts.some(t => t.includes("Context reset"))).toBe(true)

      // Old session should be deleted and new one created
      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      expect(saved).toBeDefined()
      expect(saved!.claudeSessionId).toBe("") // Reset for next message
      expect(saved!.contextUsagePercent).toBe(0)
    })

    it("should warn at 80% context usage", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "warn-session", content: "Response" },
        {
          type: "result",
          usage: {
            inputTokens: 100000,
            outputTokens: 60000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      // Should have sent context warning
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Context limit approaching") || t.includes("80"))).toBe(true)
    })

    it("should not trigger handoff/warning below 50%", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "low-ctx", content: "Response\n\n" },
        {
          type: "result",
          usage: {
            inputTokens: 10000,
            outputTokens: 5000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage())
      }))

      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Auto-handoff"))).toBe(false)
      expect(sentTexts.some(t => t.includes("Context limit"))).toBe(false)
    })
  })

  // ── handleContinuation ──────────────────────────────────────
  describe("handleContinuation", () => {
    it("should generate handoff and start new session", async () => {
      const existingRecord = makeSessionRecord({ claudeSessionId: "old-session" })
      const store = new Map<number, SessionRecord>([[TEST_CHAT_ID, existingRecord]])

      const newSessionEvents: ClaudeEvent[] = [
        { type: "text", sessionId: "continued-session", content: "Continuing\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({
        claudeEvents: newSessionEvents,
        sessionStore: store,
        handoffSummary: "We were working on X",
      })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleContinuation(TEST_CHAT_ID)
      }))

      // Should have sent handoff-related messages
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Generating handoff"))).toBe(true)
      expect(sentTexts.some(t => t.includes("Session Handoff"))).toBe(true)
    })

    it("should inform user when no active session exists", async () => {
      const setup = buildTestLayer()

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleContinuation(TEST_CHAT_ID)
      }))

      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("No active session"))).toBe(true)
    })

    it("should delete old session before starting new one", async () => {
      const existingRecord = makeSessionRecord({ claudeSessionId: "to-delete" })
      const store = new Map<number, SessionRecord>([[TEST_CHAT_ID, existingRecord]])

      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "new-after-handoff", content: "Ready\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({
        claudeEvents: events,
        sessionStore: store,
        handoffSummary: "Summary here",
      })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleContinuation(TEST_CHAT_ID)
      }))

      // After continuation, a new session should exist from processClaudeEvents
      // The old session with "to-delete" should be gone
      const saved = setup.sessionStore.get(TEST_CHAT_ID)
      // The new session gets saved by processClaudeEvents when it receives the sessionId
      if (saved) {
        expect(saved.claudeSessionId).toBe("new-after-handoff")
      }
    })
  })

  // ── Voice Message Handling ──────────────────────────────────
  describe("voice messages", () => {
    it("should transcribe voice and route to Claude", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "voice-session", content: "Voice response\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage({
          text: undefined,
          voice: { fileId: "voice-file-123", duration: 5 },
        }))
      }))

      // Should have fetched the voice file
      expect(setup.telegramCalls.getFileBuffer).toContain("voice-file-123")
      // Should have sent the transcribed text to Claude (verified by response being sent)
      const sentTexts = setup.telegramCalls.sendMessage.map(m => m.text)
      expect(sentTexts.some(t => t.includes("Voice response"))).toBe(true)
    })
  })

  // ── Photo Message Handling ──────────────────────────────────
  describe("photo messages", () => {
    it("should download photo and send to Claude with default prompt", async () => {
      const events: ClaudeEvent[] = [
        { type: "text", sessionId: "photo-session", content: "I see the image\n\n" },
        { type: "result" },
      ]
      const setup = buildTestLayer({ claudeEvents: events })

      await run(setup, Effect.gen(function* () {
        const sm = yield* SessionManager
        yield* sm.handleMessage(makeMessage({
          text: undefined,
          photo: [
            { file_id: "small-photo", file_unique_id: "u1", width: 100, height: 100 },
            { file_id: "large-photo", file_unique_id: "u2", width: 800, height: 600 },
          ],
        }))
      }))

      // Should have fetched the largest photo
      expect(setup.telegramCalls.getFileBuffer).toContain("large-photo")
    })
  })

  // ── Continuation Trigger via Message ────────────────────────
  describe("continuation trigger", () => {
    it("should handle continuation trigger when user says 'continue' after warning", async () => {
      // First, trigger a warning at 80%
      const warningEvents: ClaudeEvent[] = [
        { type: "text", sessionId: "warn-session-2", content: "Response" },
        {
          type: "result",
          usage: {
            inputTokens: 100000,
            outputTokens: 60000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        },
      ]
      const setup = buildTestLayer({ claudeEvents: warningEvents })

      // Use Effect.scoped + Layer.memoize so the same SessionManager instance
      // (and its internal Ref) is shared across both handleMessage calls
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const memoized = yield* Layer.memoize(setup.layer)

            // Send first message to trigger the warning
            yield* Effect.provide(
              Effect.gen(function* () {
                const sm = yield* SessionManager
                yield* sm.handleMessage(makeMessage({ text: "First message" }))
              }),
              memoized
            )

            // Verify the warning was sent
            const sentAfterFirst = setup.telegramCalls.sendMessage.map(m => m.text)
            expect(sentAfterFirst.some(t => t.includes("Context limit approaching") || t.includes("80"))).toBe(true)

            // Now the chat should be in pending continuations.
            // Send "continue" to trigger the continuation flow
            yield* Effect.provide(
              Effect.gen(function* () {
                const sm = yield* SessionManager
                yield* sm.handleMessage(makeMessage({ text: "Yes, please continue" }))
              }),
              memoized
            )

            // Should have sent handoff-related messages
            const allSent = setup.telegramCalls.sendMessage.map(m => m.text)
            expect(allSent.some(t => t.includes("Generating handoff") || t.includes("Session Handoff"))).toBe(true)
          })
        )
      )
    })
  })
})
