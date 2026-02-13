/**
 * Unit Tests for ClaudeSession Service
 *
 * Tests JSONL stream parsing, process lifecycle, session resumption,
 * and error handling by mocking child_process.spawn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { EventEmitter } from "events"
import { Readable, Writable } from "stream"
import { ClaudeSession, ClaudeSessionLive } from "../../services/ClaudeSession.js"
import type { ClaudeEvent } from "../../services/ClaudeSession.js"
import { ConfigService } from "../../services/Config.js"
import type { AppConfig } from "../../services/Config.js"
import { SoulLoader } from "../../services/SoulLoader.js"
import type { SoulLoaderService } from "../../services/SoulLoader.js"
import { ClaudeMem } from "../../services/ClaudeMem.js"
import type { ClaudeMemService } from "../../services/ClaudeMem.js"

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}))

import { spawn } from "child_process"
const mockSpawn = vi.mocked(spawn)

// ---------------------------------------------------------------------------
// Helpers: fake child process
// ---------------------------------------------------------------------------

interface FakeChildProcess extends EventEmitter {
  stdin: Writable | null
  stdout: Readable | null
  stderr: Readable | null
  kill: ReturnType<typeof vi.fn>
}

function createFakeChildProcess(): FakeChildProcess {
  const cp = new EventEmitter() as FakeChildProcess
  cp.stdin = new Writable({ write(_chunk, _enc, cb) { cb() } })
  cp.stdout = new Readable({ read() {} })
  cp.stderr = new Readable({ read() {} })
  cp.kill = vi.fn()
  return cp
}

function emitStdout(cp: FakeChildProcess, data: string): void {
  cp.stdout!.push(Buffer.from(data))
}

function closeProcess(cp: FakeChildProcess, code: number | null): void {
  cp.emit("close", code)
}

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

const testConfig: AppConfig = {
  telegram: { botToken: "test-token", userId: 12345 },
  anthropic: { apiKey: "test-key" },
  workspace: { path: "/tmp/test" },
  database: { path: ":memory:" },
}

const mockConfigLayer = Layer.succeed(ConfigService, testConfig)

const createMockSoulLoader = (soul = ""): SoulLoaderService => ({
  getSoul: () => Effect.succeed(soul),
  reloadSoul: () => Effect.succeed(soul),
})

const createMockClaudeMem = (): ClaudeMemService => ({
  initSession: () => Effect.void,
  query: () => Effect.succeed(""),
  store: () => Effect.void,
  summarize: () => Effect.void,
})

function buildTestLayer(options?: {
  soul?: string
  claudeMem?: Partial<ClaudeMemService>
}): Layer.Layer<ClaudeSession> {
  const soulLayer = Layer.succeed(SoulLoader, createMockSoulLoader(options?.soul))
  const memImpl = { ...createMockClaudeMem(), ...options?.claudeMem }
  const memLayer = Layer.succeed(ClaudeMem, memImpl)

  return ClaudeSessionLive.pipe(
    Layer.provide(Layer.mergeAll(mockConfigLayer, soulLayer, memLayer))
  )
}

async function collectStreamEvents(
  layer: Layer.Layer<ClaudeSession>,
  options: Parameters<ClaudeEvent extends never ? never : typeof ClaudeSession.prototype>[0] extends never
    ? never
    : {
        prompt: string
        cwd: string
        resumeSessionId?: string
        images?: Array<{ data: Buffer; mediaType: string }>
      }
): Promise<ClaudeEvent[]> {
  const events: ClaudeEvent[] = []
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const session = yield* ClaudeSession
        const stream = session.sendMessage(options)
        yield* Stream.runForEach(stream, (event) =>
          Effect.sync(() => { events.push(event) })
        )
      }),
      layer
    )
  )
  return events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeSession", () => {
  let fakeProcess: FakeChildProcess

  beforeEach(() => {
    vi.clearAllMocks()
    fakeProcess = createFakeChildProcess()
    mockSpawn.mockReturnValue(fakeProcess as ReturnType<typeof spawn>)
  })

  // -----------------------------------------------------------------------
  // JSONL stream parsing
  // -----------------------------------------------------------------------
  describe("JSONL stream parsing", () => {
    it("should parse system init event and emit text with sessionId", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      // Allow async IIFE in Stream.async to execute
      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-123",
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      expect(events.length).toBeGreaterThanOrEqual(1)

      const initEvent = events.find((e) => e.sessionId === "sess-123")
      expect(initEvent).toBeDefined()
      expect(initEvent!.type).toBe("text")
      expect(initEvent!.content).toBe("")
    })

    it("should parse assistant text events", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello there!" },
          ],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const textEvent = events.find((e) => e.type === "text" && e.content === "Hello there!")
      expect(textEvent).toBeDefined()
    })

    it("should parse assistant tool_use events", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const toolEvent = events.find((e) => e.type === "tool_call")
      expect(toolEvent).toBeDefined()
      expect(toolEvent!.toolCall).toBeDefined()
      expect(toolEvent!.toolCall!.name).toBe("Read")
      expect(toolEvent!.toolCall!.input).toEqual({ file_path: "/src/index.ts" })
    })

    it("should parse user tool_result events and match pending tool calls", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      // First emit tool_use to create pending entry
      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "tool-42",
            name: "Bash",
            input: { command: "ls" },
          }],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))

      // Then emit tool_result
      emitStdout(fakeProcess, JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool-42",
            content: "file1.ts\nfile2.ts",
          }],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const resultEvent = events.find((e) => e.type === "tool_result")
      expect(resultEvent).toBeDefined()
      expect(resultEvent!.toolCall!.name).toBe("Bash")
      expect(resultEvent!.toolCall!.result).toBe("file1.ts\nfile2.ts")
    })

    it("should handle tool_result with array content", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "tool-99",
            name: "Read",
            input: { file_path: "/foo" },
          }],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))

      emitStdout(fakeProcess, JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool-99",
            content: [
              { type: "text", text: "line1" },
              { type: "image", data: "..." },
              { type: "text", text: "line2" },
            ],
          }],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const resultEvent = events.find((e) => e.type === "tool_result")
      expect(resultEvent).toBeDefined()
      expect(resultEvent!.toolCall!.result).toBe("line1\nline2")
    })

    it("should parse result events with usage and cost", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "result",
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 100,
            contextWindow: 200000,
          },
        },
        total_cost_usd: 0.0123,
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const resultEvent = events.find((e) => e.type === "result")
      expect(resultEvent).toBeDefined()
      expect(resultEvent!.usage).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        contextWindow: 200000,
      })
      expect(resultEvent!.cost).toBe(0.0123)
    })

    it("should handle result with no modelUsage gracefully", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "result",
        total_cost_usd: 0.001,
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const resultEvent = events.find((e) => e.type === "result")
      expect(resultEvent).toBeDefined()
      expect(resultEvent!.usage).toBeUndefined()
      expect(resultEvent!.cost).toBe(0.001)
    })

    it("should ignore malformed JSON lines without crashing", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, "this is not json\n")
      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "after bad line" }] },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const textEvent = events.find((e) => e.content === "after bad line")
      expect(textEvent).toBeDefined()
    })

    it("should handle buffered/split JSONL lines across chunks", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      const fullLine = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "split across chunks" }] },
      })

      // Send first half without newline
      emitStdout(fakeProcess, fullLine.substring(0, 30))

      await new Promise((r) => setTimeout(r, 20))

      // Send rest with newline
      emitStdout(fakeProcess, fullLine.substring(30) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const textEvent = events.find((e) => e.content === "split across chunks")
      expect(textEvent).toBeDefined()
    })

    it("should skip empty lines in JSONL stream", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, "\n\n" + JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "after blanks" }] },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const textEvent = events.find((e) => e.content === "after blanks")
      expect(textEvent).toBeDefined()
    })

    it("should handle multiple content blocks in one assistant message", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First block" },
            { type: "text", text: "Second block" },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "pwd" } },
          ],
        },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const textEvents = events.filter((e) => e.type === "text")
      const toolEvents = events.filter((e) => e.type === "tool_call")

      expect(textEvents.some((e) => e.content === "First block")).toBe(true)
      expect(textEvents.some((e) => e.content === "Second block")).toBe(true)
      expect(toolEvents).toHaveLength(1)
      expect(toolEvents[0].toolCall!.name).toBe("Bash")
    })
  })

  // -----------------------------------------------------------------------
  // Process lifecycle
  // -----------------------------------------------------------------------
  describe("Process lifecycle", () => {
    it("should spawn claude CLI with correct arguments", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test prompt",
        cwd: "/workspace",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [cmd, args, opts] = mockSpawn.mock.calls[0]
      expect(cmd).toBe("claude")
      expect(args).toContain("-p")
      expect(args).toContain("--verbose")
      expect(args).toContain("--output-format")
      expect(args).toContain("stream-json")
      expect(args).toContain("--permission-mode")
      expect(args).toContain("bypassPermissions")
      expect(args).toContain("--max-turns")
      expect(args).toContain("50")
      expect(opts.cwd).toBe("/workspace")
      expect(opts.shell).toBe(false)
      expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"])
    })

    it("should strip ANTHROPIC_API_KEY from child process env", async () => {
      // Set the key in current process env temporarily
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = "sk-test-key"

      try {
        const layer = buildTestLayer()

        const promise = collectStreamEvents(layer, {
          prompt: "test",
          cwd: "/tmp",
        })

        await new Promise((r) => setTimeout(r, 50))
        closeProcess(fakeProcess, 0)
        await promise

        const envPassed = mockSpawn.mock.calls[0][2].env
        expect(envPassed.ANTHROPIC_API_KEY).toBeUndefined()
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original
        } else {
          delete process.env.ANTHROPIC_API_KEY
        }
      }
    })

    it("should call stdin.end() after spawning", async () => {
      const stdinEndSpy = vi.fn()
      fakeProcess.stdin = new Writable({
        write(_chunk, _enc, cb) { cb() },
      })
      fakeProcess.stdin.end = stdinEndSpy

      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      expect(stdinEndSpy).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Session resumption
  // -----------------------------------------------------------------------
  describe("Session resumption", () => {
    it("should add --resume flag when resumeSessionId is provided", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "continue",
        cwd: "/tmp",
        resumeSessionId: "prev-sess-456",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toContain("--resume")
      expect(args).toContain("prev-sess-456")
    })

    it("should NOT add --resume flag when resumeSessionId is absent", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "new session",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).not.toContain("--resume")
    })

    it("should inject soul into prompt for new sessions", async () => {
      const layer = buildTestLayer({ soul: "You are Maslow." })

      const promise = collectStreamEvents(layer, {
        prompt: "hello",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain("You are Maslow.")
      expect(promptArg).toContain("hello")
    })

    it("should NOT inject soul into prompt for resumed sessions", async () => {
      const layer = buildTestLayer({ soul: "You are Maslow." })

      const promise = collectStreamEvents(layer, {
        prompt: "continue work",
        cwd: "/tmp",
        resumeSessionId: "existing-sess",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).not.toContain("You are Maslow.")
      expect(promptArg).toContain("continue work")
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe("Error handling", () => {
    it("should emit error event on non-zero exit code", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 1)

      const events = await promise
      const errorEvent = events.find((e) => e.type === "error")
      expect(errorEvent).toBeDefined()
      expect(errorEvent!.error).toContain("exited with code 1")
    })

    it("should NOT emit error event on exit code 0", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)

      const events = await promise
      const errorEvent = events.find((e) => e.type === "error")
      expect(errorEvent).toBeUndefined()
    })

    it("should emit error event when spawn fails", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      fakeProcess.emit("error", new Error("ENOENT: claude not found"))

      const events = await promise
      const errorEvent = events.find((e) => e.type === "error")
      expect(errorEvent).toBeDefined()
      expect(errorEvent!.error).toContain("Failed to spawn claude CLI")
      expect(errorEvent!.error).toContain("claude not found")
    })

    it("should handle exit code null (signal kill) without error event", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "test",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, null)

      const events = await promise
      const errorEvent = events.find((e) => e.type === "error")
      expect(errorEvent).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // generateHandoff
  // -----------------------------------------------------------------------
  describe("generateHandoff", () => {
    it("should spawn claude with --resume and --max-turns 1", async () => {
      const layer = buildTestLayer()

      const promise = Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const session = yield* ClaudeSession
            return yield* session.generateHandoff({
              sessionId: "sess-abc",
              cwd: "/workspace",
            })
          }),
          layer
        )
      )

      await new Promise((r) => setTimeout(r, 50))

      emitStdout(fakeProcess, JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Handoff summary content" }] },
      }) + "\n")

      await new Promise((r) => setTimeout(r, 20))
      closeProcess(fakeProcess, 0)

      const result = await promise
      expect(result).toBe("Handoff summary content")

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toContain("--resume")
      expect(args).toContain("sess-abc")
      expect(args).toContain("--max-turns")
      expect(args).toContain("1")
    })

    it("should return default message when no summary is generated", async () => {
      const layer = buildTestLayer()

      const promise = Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const session = yield* ClaudeSession
            return yield* session.generateHandoff({
              sessionId: "sess-empty",
              cwd: "/tmp",
            })
          }),
          layer
        )
      )

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)

      const result = await promise
      expect(result).toBe("No summary generated.")
    })

    it("should reject when process exits with non-zero code", async () => {
      const layer = buildTestLayer()

      const promise = Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const session = yield* ClaudeSession
            return yield* session.generateHandoff({
              sessionId: "sess-fail",
              cwd: "/tmp",
            })
          }),
          layer
        )
      )

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 1)

      await expect(promise).rejects.toThrow("Handoff generation failed with code 1")
    })

    it("should strip ANTHROPIC_API_KEY from handoff env", async () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = "sk-handoff-key"

      try {
        const layer = buildTestLayer()

        const promise = Effect.runPromise(
          Effect.provide(
            Effect.gen(function* () {
              const session = yield* ClaudeSession
              return yield* session.generateHandoff({
                sessionId: "sess-env",
                cwd: "/tmp",
              })
            }),
            layer
          )
        )

        await new Promise((r) => setTimeout(r, 50))
        closeProcess(fakeProcess, 0)
        await promise

        const envPassed = mockSpawn.mock.calls[0][2].env
        expect(envPassed.ANTHROPIC_API_KEY).toBeUndefined()
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original
        } else {
          delete process.env.ANTHROPIC_API_KEY
        }
      }
    })
  })

  // -----------------------------------------------------------------------
  // Memory integration
  // -----------------------------------------------------------------------
  describe("Memory integration", () => {
    it("should prepend memories to prompt when available", async () => {
      const layer = buildTestLayer({
        claudeMem: {
          query: () => Effect.succeed("Previous context about project X"),
        },
      })

      const promise = collectStreamEvents(layer, {
        prompt: "what were we doing?",
        cwd: "/tmp",
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain("Relevant memories:")
      expect(promptArg).toContain("Previous context about project X")
      expect(promptArg).toContain("what were we doing?")
    })

    it("should handle image attachments in prompt", async () => {
      const layer = buildTestLayer()

      const promise = collectStreamEvents(layer, {
        prompt: "what is this?",
        cwd: "/tmp",
        images: [{ data: Buffer.from("fake-image"), mediaType: "image/png" }],
      })

      await new Promise((r) => setTimeout(r, 50))
      closeProcess(fakeProcess, 0)
      await promise

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain("[Image attached]")
      expect(promptArg).toContain("what is this?")
    })
  })
})
