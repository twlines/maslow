/**
 * SessionManager Tests
 *
 * Tests message routing, continuation flow, voice message handling,
 * and workspace action execution with fully mocked dependencies.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer, Stream } from "effect"
import {
  SessionManager,
  SessionManagerLive,
} from "../../services/SessionManager.js"
import { Persistence, type SessionRecord } from "../../services/Persistence.js"
import {
  ClaudeSession,
  type ClaudeEvent,
} from "../../services/ClaudeSession.js"
import { Telegram, type TelegramMessage } from "../../services/Telegram.js"
import { MessageFormatter } from "../../services/MessageFormatter.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import { Heartbeat } from "../../services/Heartbeat.js"
import { Voice } from "../../services/Voice.js"
import { Kanban } from "../../services/Kanban.js"
import { ThinkingPartner } from "../../services/ThinkingPartner.js"

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const makeSessionRecord = (
  overrides: Partial<SessionRecord> = {}
): SessionRecord => ({
  telegramChatId: 123,
  claudeSessionId: "",
  projectPath: null,
  workingDirectory: "/workspace",
  lastActiveAt: Date.now(),
  contextUsagePercent: 0,
  ...overrides,
})

const makeTextMessage = (
  overrides: Partial<TelegramMessage> = {}
): TelegramMessage => ({
  chatId: 123,
  userId: 1,
  messageId: 42,
  text: "Hello",
  ...overrides,
})

const makeResultEvent = (
  overrides: Partial<ClaudeEvent> = {}
): ClaudeEvent => ({
  type: "result",
  sessionId: "sess-1",
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextWindow: 200000,
  },
  ...overrides,
})

// Track calls to mock services
interface MockCalls {
  sendMessage: Array<{ chatId: number; text: string }>
  editMessage: Array<{ chatId: number; messageId: number; text: string }>
  sendTyping: number[]
  getSession: number[]
  saveSession: SessionRecord[]
  deleteSession: number[]
  updateLastActive: number[]
  updateContextUsage: Array<{ chatId: number; percent: number }>
  getFileBuffer: string[]
  transcribe: Buffer[]
  synthesize: string[]
  sendVoiceNote: Array<{ chatId: number }>
  sendRecordingVoice: number[]
  submitTaskBrief: string[]
  createCard: Array<{ projectId: string; title: string }>
  moveCard: Array<{ id: string; column: string }>
  logDecision: Array<{ projectId: string; title: string }>
  addAssumption: Array<{ projectId: string; assumption: string }>
  updateStateSummary: Array<{ projectId: string; summary: string }>
  generateHandoff: Array<{ sessionId: string }>
  claudeSendMessage: Array<{ prompt: string }>
}

let calls: MockCalls
let sessionStore: Map<number, SessionRecord>
let claudeEvents: ClaudeEvent[]

const resetMocks = () => {
  calls = {
    sendMessage: [],
    editMessage: [],
    sendTyping: [],
    getSession: [],
    saveSession: [],
    deleteSession: [],
    updateLastActive: [],
    updateContextUsage: [],
    getFileBuffer: [],
    transcribe: [],
    synthesize: [],
    sendVoiceNote: [],
    sendRecordingVoice: [],
    submitTaskBrief: [],
    createCard: [],
    moveCard: [],
    logDecision: [],
    addAssumption: [],
    updateStateSummary: [],
    generateHandoff: [],
    claudeSendMessage: [],
  }
  sessionStore = new Map()
  claudeEvents = [
    { type: "text", content: "Hello back!", sessionId: "sess-1" },
    makeResultEvent(),
  ]
}

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

const createMockLayers = () => {
  const configLayer = Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 123 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/workspace" },
    database: { path: ":memory:" },
  } satisfies AppConfig)

  const persistenceLayer = Layer.succeed(Persistence, {
    getSession: (chatId) =>
      Effect.sync(() => {
        calls.getSession.push(chatId)
        return sessionStore.get(chatId) ?? null
      }),
    saveSession: (record) =>
      Effect.sync(() => {
        calls.saveSession.push(record)
        sessionStore.set(record.telegramChatId, record)
      }),
    updateLastActive: (chatId) =>
      Effect.sync(() => {
        calls.updateLastActive.push(chatId)
      }),
    updateContextUsage: (chatId, percent) =>
      Effect.sync(() => {
        calls.updateContextUsage.push({ chatId, percent })
      }),
    deleteSession: (chatId) =>
      Effect.sync(() => {
        calls.deleteSession.push(chatId)
        sessionStore.delete(chatId)
      }),
    getLastActiveChatId: () => Effect.succeed(null),
    close: () => Effect.void,
  })

  const claudeSessionLayer = Layer.succeed(ClaudeSession, {
    sendMessage: (options) => {
      calls.claudeSendMessage.push({ prompt: options.prompt })
      return Stream.fromIterable(claudeEvents)
    },
    generateHandoff: (options) => {
      calls.generateHandoff.push({ sessionId: options.sessionId })
      return Effect.succeed("Handoff summary content")
    },
  })

  const telegramLayer = Layer.succeed(Telegram, {
    messages: Stream.empty,
    sendMessage: (chatId, text, _options?) =>
      Effect.sync(() => {
        calls.sendMessage.push({ chatId, text })
        return { message_id: 100 } as any
      }),
    sendTyping: (chatId) =>
      Effect.sync(() => {
        calls.sendTyping.push(chatId)
      }),
    editMessage: (chatId, messageId, text) =>
      Effect.sync(() => {
        calls.editMessage.push({ chatId, messageId, text })
      }),
    getFileBuffer: (fileId) => {
      calls.getFileBuffer.push(fileId)
      return Effect.succeed(Buffer.from("fake-audio-data"))
    },
    sendVoiceNote: (chatId, _audioBuffer, _options?) =>
      Effect.sync(() => {
        calls.sendVoiceNote.push({ chatId })
        return { message_id: 101 } as any
      }),
    sendRecordingVoice: (chatId) =>
      Effect.sync(() => {
        calls.sendRecordingVoice.push(chatId)
      }),
    start: () => Effect.void,
    stop: () => Effect.void,
  })

  const formatterLayer = Layer.succeed(MessageFormatter, {
    formatToolCall: (tc) => `🔧 ${tc.name}`,
    formatToolResult: (tc) => `✅ ${tc.name} done`,
    formatUsage: () => "Usage: 100 in / 50 out",
    formatContextWarning: (pct) => `⚠️ Context at ${pct.toFixed(0)}%`,
    formatHandoff: (summary) => `📋 Handoff: ${summary}`,
    formatError: (err) => `❌ Error: ${err}`,
    formatNotification: (_type, msg) => `📢 ${msg || "notification"}`,
  })

  const heartbeatLayer = Layer.succeed(Heartbeat, {
    start: () => Effect.void,
    stop: () => Effect.void,
    submitTaskBrief: (brief) => {
      calls.submitTaskBrief.push(brief)
      return Effect.succeed({
        id: "card-1",
        projectId: "proj-1",
        title: brief,
        description: brief,
        column: "backlog" as const,
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
      })
    },
    tick: () => Effect.void,
  })

  const voiceLayer = Layer.succeed(Voice, {
    transcribe: (audioBuffer) => {
      calls.transcribe.push(audioBuffer)
      return Effect.succeed("transcribed text from voice")
    },
    synthesize: (text) => {
      calls.synthesize.push(text)
      return Effect.succeed(Buffer.from("synthesized-audio"))
    },
    isAvailable: () => Effect.succeed({ stt: true, tts: true }),
  })

  const kanbanLayer = Layer.succeed(Kanban, {
    getBoard: () =>
      Effect.succeed({
        backlog: [],
        in_progress: [],
        done: [],
      }),
    createCard: (projectId, title, description, _column) => {
      calls.createCard.push({ projectId, title })
      return Effect.succeed({
        id: "card-new",
        projectId,
        title,
        description: description || "",
        column: "backlog" as const,
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
      })
    },
    updateCard: () => Effect.void,
    deleteCard: () => Effect.void,
    moveCard: (id, column) => {
      calls.moveCard.push({ id, column })
      return Effect.void
    },
    createCardFromConversation: () =>
      Effect.succeed({
        id: "card-conv",
        projectId: "telegram",
        title: "from conversation",
        description: "",
        column: "backlog" as const,
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
      }),
    getNext: () => Effect.succeed(null),
    skipToBack: () => Effect.void,
    saveContext: () => Effect.void,
    resume: () => Effect.succeed(null),
    assignAgent: () => Effect.void,
    updateAgentStatus: () => Effect.void,
    startWork: () => Effect.void,
    completeWork: () => Effect.void,
  })

  const thinkingPartnerLayer = Layer.succeed(ThinkingPartner, {
    logDecision: (projectId, decision) => {
      calls.logDecision.push({ projectId, title: decision.title })
      return Effect.succeed({
        id: "dec-1",
        projectId,
        title: decision.title,
        description: decision.description,
        alternatives: decision.alternatives,
        reasoning: decision.reasoning,
        tradeoffs: decision.tradeoffs,
        createdAt: Date.now(),
      })
    },
    getDecisions: () => Effect.succeed([]),
    addAssumption: (projectId, assumption) => {
      calls.addAssumption.push({ projectId, assumption })
      return Effect.succeed({
        id: "doc-1",
        projectId,
        type: "assumptions" as const,
        title: "Assumptions",
        content: assumption,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    },
    getAssumptions: () => Effect.succeed(null),
    updateStateSummary: (projectId, summary) => {
      calls.updateStateSummary.push({ projectId, summary })
      return Effect.void
    },
    getStateSummary: () => Effect.succeed(null),
    getProjectContext: () => Effect.succeed(""),
  })

  return Layer.mergeAll(
    configLayer,
    persistenceLayer,
    claudeSessionLayer,
    telegramLayer,
    formatterLayer,
    heartbeatLayer,
    voiceLayer,
    kanbanLayer,
    thinkingPartnerLayer
  )
}

const runSessionManager = <A>(
  effect: Effect.Effect<A, unknown, SessionManager>
): Promise<A> => {
  const deps = createMockLayers()
  const layer = SessionManagerLive.pipe(Layer.provide(deps))
  return Effect.runPromise(Effect.provide(effect, layer))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
  beforeEach(() => {
    resetMocks()
  })

  // =========================================================================
  // 1. Message Routing
  // =========================================================================
  describe("message routing", () => {
    it("should route a regular text message to Claude", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage({ text: "Hello Claude" }))
        })
      )

      // Should create a session
      expect(calls.saveSession.length).toBeGreaterThanOrEqual(1)
      // Should send typing indicator
      expect(calls.sendTyping).toContain(123)
      // Should send message to Claude with the text
      expect(calls.claudeSendMessage[0].prompt).toBe("Hello Claude")
      // Should send response back to Telegram
      expect(calls.sendMessage.length).toBeGreaterThanOrEqual(1)
    })

    it("should resume existing session when claudeSessionId is set", async () => {
      sessionStore.set(
        123,
        makeSessionRecord({ claudeSessionId: "existing-session" })
      )

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage({ text: "Continue work" }))
        })
      )

      // Should update last active instead of creating new
      expect(calls.updateLastActive).toContain(123)
      // Should not create a brand new session (already exists)
      const newSessions = calls.saveSession.filter(
        (s) => s.claudeSessionId === ""
      )
      expect(newSessions).toHaveLength(0)
    })

    it("should handle /restart_claude command", async () => {
      sessionStore.set(
        123,
        makeSessionRecord({ claudeSessionId: "old-session" })
      )

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({ text: "/restart_claude" })
          )
        })
      )

      // Should delete existing session
      expect(calls.deleteSession).toContain(123)
      // Should send confirmation message
      expect(
        calls.sendMessage.some((m) =>
          m.text.includes("Session cleared")
        )
      ).toBe(true)
      // Should NOT call Claude
      expect(calls.claudeSendMessage).toHaveLength(0)
    })

    it("should handle task brief with TASK: prefix", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({ text: "TASK: Build a new feature" })
          )
        })
      )

      // Should submit task brief to heartbeat
      expect(calls.submitTaskBrief).toContain("TASK: Build a new feature")
      // Should send autonomous mode message
      expect(
        calls.sendMessage.some((m) =>
          m.text.includes("Autonomous Mode Activated")
        )
      ).toBe(true)
      // Should NOT call Claude directly
      expect(calls.claudeSendMessage).toHaveLength(0)
    })

    it("should handle task brief with Brief: prefix", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({ text: "Brief: implement auth" })
          )
        })
      )

      expect(calls.submitTaskBrief).toContain("Brief: implement auth")
    })

    it("should use caption as prompt when text is absent", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({ text: undefined, caption: "Describe this" })
          )
        })
      )

      expect(calls.claudeSendMessage[0].prompt).toBe("Describe this")
    })

    it("should use default prompt for image-only messages", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({
              text: undefined,
              caption: undefined,
              photo: [{ file_id: "photo-1", file_unique_id: "u1", width: 800, height: 600 }],
            })
          )
        })
      )

      expect(calls.claudeSendMessage[0].prompt).toBe(
        "Please analyze this image."
      )
    })

    it("should download and pass photo to Claude", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({
              text: "What is this?",
              photo: [
                { file_id: "small", file_unique_id: "u1", width: 100, height: 100 },
                { file_id: "large", file_unique_id: "u2", width: 800, height: 600 },
              ],
            })
          )
        })
      )

      // Should download the largest photo (last in array)
      expect(calls.getFileBuffer).toContain("large")
      expect(calls.getFileBuffer).not.toContain("small")
    })
  })

  // =========================================================================
  // 2. Voice Message Handling
  // =========================================================================
  describe("voice message handling", () => {
    it("should transcribe voice message and send to Claude", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({
              text: undefined,
              voice: { fileId: "voice-1", duration: 5 },
            })
          )
        })
      )

      // Should download the voice file
      expect(calls.getFileBuffer).toContain("voice-1")
      // Should transcribe
      expect(calls.transcribe).toHaveLength(1)
      // Should send transcribed text to Claude
      expect(calls.claudeSendMessage[0].prompt).toBe(
        "transcribed text from voice"
      )
    })

    it("should respond with voice when input is voice message", async () => {
      // Set up events that include a result with some text
      claudeEvents = [
        { type: "text", content: "Voice response text", sessionId: "sess-1" },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(
            makeTextMessage({
              text: undefined,
              voice: { fileId: "voice-1", duration: 5 },
            })
          )
        })
      )

      // Should synthesize voice response
      expect(calls.synthesize.length).toBeGreaterThanOrEqual(1)
      // Should send recording indicator
      expect(calls.sendRecordingVoice).toContain(123)
      // Should send voice note
      expect(calls.sendVoiceNote.length).toBeGreaterThanOrEqual(1)
    })

    it("should gracefully handle voice transcription failure", async () => {
      // Override voice mock to fail transcription
      const failingVoiceLayer = Layer.succeed(Voice, {
        transcribe: () => Effect.fail(new Error("Whisper not available")),
        synthesize: (text) => {
          calls.synthesize.push(text)
          return Effect.succeed(Buffer.from("audio"))
        },
        isAvailable: () => Effect.succeed({ stt: false, tts: true }),
      })

      const deps = Layer.mergeAll(
        Layer.succeed(ConfigService, {
          telegram: { botToken: "test", userId: 123 },
          anthropic: { apiKey: "test" },
          workspace: { path: "/workspace" },
          database: { path: ":memory:" },
        } satisfies AppConfig),
        Layer.succeed(Persistence, {
          getSession: (chatId) => {
            calls.getSession.push(chatId)
            return Effect.succeed(sessionStore.get(chatId) ?? null)
          },
          saveSession: (record) => {
            calls.saveSession.push(record)
            sessionStore.set(record.telegramChatId, record)
            return Effect.void
          },
          updateLastActive: (chatId) => {
            calls.updateLastActive.push(chatId)
            return Effect.void
          },
          updateContextUsage: () => Effect.void,
          deleteSession: () => Effect.void,
          getLastActiveChatId: () => Effect.succeed(null),
          close: () => Effect.void,
        }),
        Layer.succeed(ClaudeSession, {
          sendMessage: (options) => {
            calls.claudeSendMessage.push({ prompt: options.prompt })
            return Stream.fromIterable(claudeEvents)
          },
          generateHandoff: () => Effect.succeed("handoff"),
        }),
        Layer.succeed(Telegram, {
          messages: Stream.empty,
          sendMessage: (chatId, text) => {
            calls.sendMessage.push({ chatId, text })
            return Effect.succeed({ message_id: 100 } as any)
          },
          sendTyping: (chatId) => {
            calls.sendTyping.push(chatId)
            return Effect.void
          },
          editMessage: () => Effect.void,
          getFileBuffer: (fileId) => {
            calls.getFileBuffer.push(fileId)
            return Effect.succeed(Buffer.from("audio"))
          },
          sendVoiceNote: () => Effect.succeed({ message_id: 101 } as any),
          sendRecordingVoice: () => Effect.void,
          start: () => Effect.void,
          stop: () => Effect.void,
        }),
        Layer.succeed(MessageFormatter, {
          formatToolCall: (tc) => `🔧 ${tc.name}`,
          formatToolResult: (tc) => `✅ ${tc.name}`,
          formatUsage: () => "usage",
          formatContextWarning: (pct) => `⚠️ ${pct}%`,
          formatHandoff: (s) => `📋 ${s}`,
          formatError: (e) => `❌ ${e}`,
          formatNotification: () => "notif",
        }),
        Layer.succeed(Heartbeat, {
          start: () => Effect.void,
          stop: () => Effect.void,
          submitTaskBrief: () => Effect.succeed({} as any),
          tick: () => Effect.void,
        }),
        failingVoiceLayer,
        Layer.succeed(Kanban, {
          getBoard: () => Effect.succeed({ backlog: [], in_progress: [], done: [] }),
          createCard: () => Effect.succeed({} as any),
          updateCard: () => Effect.void,
          deleteCard: () => Effect.void,
          moveCard: () => Effect.void,
          createCardFromConversation: () => Effect.succeed({} as any),
          getNext: () => Effect.succeed(null),
          skipToBack: () => Effect.void,
          saveContext: () => Effect.void,
          resume: () => Effect.succeed(null),
          assignAgent: () => Effect.void,
          updateAgentStatus: () => Effect.void,
          startWork: () => Effect.void,
          completeWork: () => Effect.void,
        }),
        Layer.succeed(ThinkingPartner, {
          logDecision: () => Effect.succeed({} as any),
          getDecisions: () => Effect.succeed([]),
          addAssumption: () => Effect.succeed({} as any),
          getAssumptions: () => Effect.succeed(null),
          updateStateSummary: () => Effect.void,
          getStateSummary: () => Effect.succeed(null),
          getProjectContext: () => Effect.succeed(""),
        })
      )

      const layer = SessionManagerLive.pipe(Layer.provide(deps))

      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const sm = yield* SessionManager
            yield* sm.handleMessage(
              makeTextMessage({
                text: undefined,
                voice: { fileId: "voice-fail", duration: 3 },
              })
            )
          }),
          layer
        )
      )

      // Should send error message about whisper
      expect(
        calls.sendMessage.some((m) =>
          m.text.includes("whisper")
        )
      ).toBe(true)
      // Should NOT send message to Claude (transcription failed)
      expect(calls.claudeSendMessage).toHaveLength(0)
    })
  })

  // =========================================================================
  // 3. Continuation Flow
  // =========================================================================
  describe("continuation flow", () => {
    it("should handle context warning at 80%+ usage", async () => {
      claudeEvents = [
        { type: "text", content: "Response", sessionId: "sess-1" },
        makeResultEvent({
          usage: {
            inputTokens: 170000,
            outputTokens: 10000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        }),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      // Should send context warning
      expect(
        calls.sendMessage.some((m) => m.text.includes("⚠️"))
      ).toBe(true)
      // Should update context usage
      expect(calls.updateContextUsage.length).toBeGreaterThanOrEqual(1)
      const lastUpdate = calls.updateContextUsage[calls.updateContextUsage.length - 1]
      expect(lastUpdate.percent).toBeGreaterThanOrEqual(80)
    })

    it("should trigger auto-handoff at 50% context usage", async () => {
      sessionStore.set(
        123,
        makeSessionRecord({ claudeSessionId: "old-sess" })
      )

      claudeEvents = [
        { type: "text", content: "Response", sessionId: "old-sess" },
        makeResultEvent({
          usage: {
            inputTokens: 90000,
            outputTokens: 10000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        }),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      // Should trigger auto-handoff messages
      expect(
        calls.sendMessage.some((m) => m.text.includes("Auto-handoff"))
      ).toBe(true)
      // Should generate handoff summary
      expect(calls.generateHandoff.length).toBeGreaterThanOrEqual(1)
      // Should delete old session
      expect(calls.deleteSession).toContain(123)
      // Should save new session with empty claudeSessionId
      const resetSessions = calls.saveSession.filter(
        (s) => s.claudeSessionId === "" && s.contextUsagePercent === 0
      )
      expect(resetSessions.length).toBeGreaterThanOrEqual(1)
    })

    it("should handle continuation when user says 'continue' after warning", async () => {
      // First, trigger a warning to set pendingContinuation
      claudeEvents = [
        { type: "text", content: "Response", sessionId: "sess-warn" },
        makeResultEvent({
          usage: {
            inputTokens: 170000,
            outputTokens: 10000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 200000,
          },
        }),
      ]

      sessionStore.set(
        123,
        makeSessionRecord({ claudeSessionId: "sess-warn" })
      )

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          // First message triggers warning
          yield* sm.handleMessage(makeTextMessage({ text: "Do something" }))

          // Reset events for continuation
          claudeEvents = [
            { type: "text", content: "Continuing...", sessionId: "sess-new" },
            makeResultEvent(),
          ]

          // Second message triggers continuation
          yield* sm.handleMessage(makeTextMessage({ text: "Yes, please continue" }))
        })
      )

      // Should generate handoff
      expect(calls.generateHandoff.length).toBeGreaterThanOrEqual(1)
      // Should send handoff message
      expect(
        calls.sendMessage.some((m) => m.text.includes("Handoff"))
      ).toBe(true)
    })

    it("should handle explicit handleContinuation call", async () => {
      sessionStore.set(
        123,
        makeSessionRecord({ claudeSessionId: "sess-to-continue" })
      )

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleContinuation(123)
        })
      )

      // Should send generating message
      expect(
        calls.sendMessage.some((m) =>
          m.text.includes("Generating handoff summary")
        )
      ).toBe(true)
      // Should generate handoff
      expect(calls.generateHandoff[0].sessionId).toBe("sess-to-continue")
      // Should delete old session
      expect(calls.deleteSession).toContain(123)
      // Should send handoff formatted message
      expect(
        calls.sendMessage.some((m) => m.text.includes("Handoff"))
      ).toBe(true)
      // Should start new Claude session with handoff context
      expect(
        calls.claudeSendMessage.some((m) =>
          m.prompt.includes("Previous session handoff")
        )
      ).toBe(true)
    })

    it("should handle handleContinuation with no active session", async () => {
      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleContinuation(999)
        })
      )

      // Should send "no active session" message
      expect(
        calls.sendMessage.some((m) =>
          m.text.includes("No active session")
        )
      ).toBe(true)
      // Should NOT generate handoff
      expect(calls.generateHandoff).toHaveLength(0)
    })
  })

  // =========================================================================
  // 4. Workspace Action Execution
  // =========================================================================
  describe("workspace action execution", () => {
    it("should parse and execute create_card actions from Claude response", async () => {
      claudeEvents = [
        {
          type: "text",
          content: `Here is the result.\n:::action\n{"type":"create_card","title":"New Feature","description":"Build it","column":"backlog"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      expect(calls.createCard.length).toBeGreaterThanOrEqual(1)
      expect(calls.createCard[0].title).toBe("New Feature")
      expect(calls.createCard[0].projectId).toBe("telegram")
    })

    it("should parse and execute move_card actions", async () => {
      // Set up kanban board with a card to move
      const kanbanLayerWithCard = Layer.succeed(Kanban, {
        getBoard: () =>
          Effect.succeed({
            backlog: [
              {
                id: "card-abc",
                projectId: "telegram",
                title: "Existing Card",
                description: "",
                column: "backlog" as const,
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
              },
            ],
            in_progress: [],
            done: [],
          }),
        createCard: () => Effect.succeed({} as any),
        updateCard: () => Effect.void,
        deleteCard: () => Effect.void,
        moveCard: (id, column) => {
          calls.moveCard.push({ id, column })
          return Effect.void
        },
        createCardFromConversation: () => Effect.succeed({} as any),
        getNext: () => Effect.succeed(null),
        skipToBack: () => Effect.void,
        saveContext: () => Effect.void,
        resume: () => Effect.succeed(null),
        assignAgent: () => Effect.void,
        updateAgentStatus: () => Effect.void,
        startWork: () => Effect.void,
        completeWork: () => Effect.void,
      })

      claudeEvents = [
        {
          type: "text",
          content: `Done.\n:::action\n{"type":"move_card","title":"Existing Card","column":"done"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      const deps = Layer.mergeAll(
        Layer.succeed(ConfigService, {
          telegram: { botToken: "test", userId: 123 },
          anthropic: { apiKey: "test" },
          workspace: { path: "/workspace" },
          database: { path: ":memory:" },
        } satisfies AppConfig),
        Layer.succeed(Persistence, {
          getSession: (chatId) => Effect.succeed(sessionStore.get(chatId) ?? null),
          saveSession: (record) => {
            calls.saveSession.push(record)
            sessionStore.set(record.telegramChatId, record)
            return Effect.void
          },
          updateLastActive: () => Effect.void,
          updateContextUsage: () => Effect.void,
          deleteSession: () => Effect.void,
          getLastActiveChatId: () => Effect.succeed(null),
          close: () => Effect.void,
        }),
        Layer.succeed(ClaudeSession, {
          sendMessage: (options) => {
            calls.claudeSendMessage.push({ prompt: options.prompt })
            return Stream.fromIterable(claudeEvents)
          },
          generateHandoff: () => Effect.succeed("handoff"),
        }),
        Layer.succeed(Telegram, {
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
        }),
        Layer.succeed(MessageFormatter, {
          formatToolCall: (tc) => `🔧 ${tc.name}`,
          formatToolResult: (tc) => `✅ ${tc.name}`,
          formatUsage: () => "usage",
          formatContextWarning: (pct) => `⚠️ ${pct}%`,
          formatHandoff: (s) => `📋 ${s}`,
          formatError: (e) => `❌ ${e}`,
          formatNotification: () => "notif",
        }),
        Layer.succeed(Heartbeat, {
          start: () => Effect.void,
          stop: () => Effect.void,
          submitTaskBrief: () => Effect.succeed({} as any),
          tick: () => Effect.void,
        }),
        Layer.succeed(Voice, {
          transcribe: () => Effect.succeed(""),
          synthesize: () => Effect.succeed(Buffer.from("")),
          isAvailable: () => Effect.succeed({ stt: true, tts: true }),
        }),
        kanbanLayerWithCard,
        Layer.succeed(ThinkingPartner, {
          logDecision: () => Effect.succeed({} as any),
          getDecisions: () => Effect.succeed([]),
          addAssumption: () => Effect.succeed({} as any),
          getAssumptions: () => Effect.succeed(null),
          updateStateSummary: () => Effect.void,
          getStateSummary: () => Effect.succeed(null),
          getProjectContext: () => Effect.succeed(""),
        })
      )

      const layer = SessionManagerLive.pipe(Layer.provide(deps))
      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const sm = yield* SessionManager
            yield* sm.handleMessage(makeTextMessage())
          }),
          layer
        )
      )

      expect(calls.moveCard.length).toBeGreaterThanOrEqual(1)
      expect(calls.moveCard[0].id).toBe("card-abc")
      expect(calls.moveCard[0].column).toBe("done")
    })

    it("should parse and execute log_decision actions", async () => {
      claudeEvents = [
        {
          type: "text",
          content: `Decided.\n:::action\n{"type":"log_decision","title":"Use Effect-TS","description":"Framework choice","alternatives":["RxJS"],"reasoning":"Better types","tradeoffs":"Learning curve"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      expect(calls.logDecision.length).toBeGreaterThanOrEqual(1)
      expect(calls.logDecision[0].title).toBe("Use Effect-TS")
      expect(calls.logDecision[0].projectId).toBe("telegram")
    })

    it("should parse and execute add_assumption actions", async () => {
      claudeEvents = [
        {
          type: "text",
          content: `Noted.\n:::action\n{"type":"add_assumption","assumption":"Users have Node 18+"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      expect(calls.addAssumption.length).toBeGreaterThanOrEqual(1)
      expect(calls.addAssumption[0].assumption).toBe("Users have Node 18+")
    })

    it("should parse and execute update_state actions", async () => {
      claudeEvents = [
        {
          type: "text",
          content: `Updated.\n:::action\n{"type":"update_state","summary":"Auth module complete"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      expect(calls.updateStateSummary.length).toBeGreaterThanOrEqual(1)
      expect(calls.updateStateSummary[0].summary).toBe("Auth module complete")
    })

    it("should handle multiple workspace actions in a single response", async () => {
      claudeEvents = [
        {
          type: "text",
          content: `Done.\n:::action\n{"type":"create_card","title":"Card A","description":"First"}\n:::\n:::action\n{"type":"add_assumption","assumption":"Runs on Linux"}\n:::\n`,
          sessionId: "sess-1",
        },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      expect(calls.createCard.length).toBeGreaterThanOrEqual(1)
      expect(calls.addAssumption.length).toBeGreaterThanOrEqual(1)
    })
  })

  // =========================================================================
  // 5. Event Processing
  // =========================================================================
  describe("event processing", () => {
    it("should handle tool_call events", async () => {
      claudeEvents = [
        {
          type: "tool_call",
          toolCall: { name: "Read", input: { file_path: "/src/index.ts" } },
          sessionId: "sess-1",
        },
        { type: "tool_result", sessionId: "sess-1" },
        { type: "text", content: "File contents read.", sessionId: "sess-1" },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      // Should send formatted tool call
      expect(
        calls.sendMessage.some((m) => m.text.includes("Read"))
      ).toBe(true)
      // Should send typing on tool_result
      expect(calls.sendTyping.length).toBeGreaterThan(0)
    })

    it("should handle error events", async () => {
      claudeEvents = [
        { type: "error", error: "Something broke", sessionId: "sess-1" },
        makeResultEvent(),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      // Should send formatted error message
      expect(
        calls.sendMessage.some((m) => m.text.includes("Error"))
      ).toBe(true)
    })

    it("should update session with new sessionId from Claude", async () => {
      claudeEvents = [
        { type: "text", content: "Hi", sessionId: "new-session-id" },
        makeResultEvent({ sessionId: "new-session-id" }),
      ]

      await runSessionManager(
        Effect.gen(function* () {
          const sm = yield* SessionManager
          yield* sm.handleMessage(makeTextMessage())
        })
      )

      // Should save session with the new sessionId
      const savedWithId = calls.saveSession.filter(
        (s) => s.claudeSessionId === "new-session-id"
      )
      expect(savedWithId.length).toBeGreaterThanOrEqual(1)
    })
  })
})
