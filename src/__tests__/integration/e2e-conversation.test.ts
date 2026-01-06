/**
 * End-to-End Integration Tests: Real Conversation Flow
 *
 * These tests use REAL services - actual Claude API calls,
 * real Telegram messaging, and real SQLite persistence.
 *
 * Requirements:
 * - ANTHROPIC_API_KEY: Valid Anthropic API key
 * - TELEGRAM_BOT_TOKEN: Valid Telegram bot token (optional for Claude-only tests)
 * - TELEGRAM_USER_ID: Your Telegram user ID (optional for Claude-only tests)
 *
 * Run with: npm test -- --testTimeout=60000
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Effect, Layer, Stream, Chunk, Fiber } from "effect";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Services
import { ConfigService, ConfigLive, type AppConfig } from "../../services/Config.js";
import { Persistence, PersistenceLive, type SessionRecord } from "../../services/Persistence.js";
import { ClaudeSession, ClaudeSessionLive, type ClaudeEvent } from "../../services/ClaudeSession.js";
import { Telegram, TelegramLive, type TelegramMessage } from "../../services/Telegram.js";
import { MessageFormatter, MessageFormatterLive } from "../../services/MessageFormatter.js";
import { SessionManager, SessionManagerLive } from "../../services/SessionManager.js";

// ============================================================================
// Test Configuration
// ============================================================================

const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasTelegramCredentials = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_USER_ID);

const createTempDbPath = () => {
  const tmpDir = os.tmpdir();
  const dbDir = path.join(tmpDir, "telegram-claude-e2e-test");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
};

const cleanupTempDb = (dbPath: string) => {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {
    // Ignore
  }
};

// ============================================================================
// Real Service Layer Factories
// ============================================================================

/**
 * Creates a config layer using real environment variables
 */
const createRealConfigLayer = (dbPath: string) => {
  const config: AppConfig = {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "test-token",
      userId: parseInt(process.env.TELEGRAM_USER_ID || "0", 10),
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    },
    workspace: {
      path: process.env.WORKSPACE_PATH || os.tmpdir(),
    },
    database: {
      path: dbPath,
    },
  };
  return Layer.succeed(ConfigService, config);
};

// ============================================================================
// Claude API Integration Tests
// ============================================================================

describe("Claude API Integration", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  describe.runIf(hasAnthropicKey)("Real Claude Streaming", () => {
    it("should stream a response from Claude for a simple prompt", async () => {
      const configLayer = createRealConfigLayer(tempDbPath);
      const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));

      const events: ClaudeEvent[] = [];

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const claude = yield* ClaudeSession;

            const stream = claude.sendMessage({
              prompt: "Reply with exactly: 'Hello from Claude!' and nothing else.",
              cwd: os.tmpdir(),
            });

            yield* Stream.runForEach(stream, (event) =>
              Effect.sync(() => {
                events.push(event);
              })
            );
          }).pipe(Effect.provide(claudeLayer))
        )
      );

      // Verify we got events
      expect(events.length).toBeGreaterThan(0);

      // Should have at least one text event
      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents.length).toBeGreaterThan(0);

      // Should have a result event with usage
      const resultEvent = events.find((e) => e.type === "result");
      expect(resultEvent).toBeDefined();
      expect(resultEvent?.usage).toBeDefined();
      expect(resultEvent?.usage?.inputTokens).toBeGreaterThan(0);

      // Should have a session ID
      const sessionId = events.find((e) => e.sessionId)?.sessionId;
      expect(sessionId).toBeDefined();
    }, 60000);

    it("should execute tool calls and return results", async () => {
      const configLayer = createRealConfigLayer(tempDbPath);
      const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));

      const events: ClaudeEvent[] = [];

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const claude = yield* ClaudeSession;

            const stream = claude.sendMessage({
              prompt: "What files are in the current directory? Use the Bash tool to run 'ls -la' and tell me.",
              cwd: os.tmpdir(),
            });

            yield* Stream.runForEach(stream, (event) =>
              Effect.sync(() => {
                events.push(event);
              })
            );
          }).pipe(Effect.provide(claudeLayer))
        )
      );

      // Should have tool call events
      const toolCallEvents = events.filter((e) => e.type === "tool_call");
      expect(toolCallEvents.length).toBeGreaterThan(0);

      // At least one should be a Bash tool
      const bashCall = toolCallEvents.find((e) => e.toolCall?.name === "Bash");
      expect(bashCall).toBeDefined();

      // Should have tool result events
      const toolResultEvents = events.filter((e) => e.type === "tool_result");
      expect(toolResultEvents.length).toBeGreaterThan(0);
    }, 120000);

    it("should resume an existing session", async () => {
      const configLayer = createRealConfigLayer(tempDbPath);
      const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));

      let firstSessionId: string | undefined;
      const firstEvents: ClaudeEvent[] = [];
      const secondEvents: ClaudeEvent[] = [];

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const claude = yield* ClaudeSession;

            // First message
            const stream1 = claude.sendMessage({
              prompt: "Remember this number: 42. Reply with 'I will remember 42.'",
              cwd: os.tmpdir(),
            });

            yield* Stream.runForEach(stream1, (event) =>
              Effect.sync(() => {
                firstEvents.push(event);
                if (event.sessionId) firstSessionId = event.sessionId;
              })
            );

            expect(firstSessionId).toBeDefined();

            // Second message resuming the session
            const stream2 = claude.sendMessage({
              prompt: "What number did I ask you to remember? Just reply with the number.",
              cwd: os.tmpdir(),
              resumeSessionId: firstSessionId,
            });

            yield* Stream.runForEach(stream2, (event) =>
              Effect.sync(() => {
                secondEvents.push(event);
              })
            );
          }).pipe(Effect.provide(claudeLayer))
        )
      );

      // Second response should mention 42
      const secondText = secondEvents
        .filter((e) => e.type === "text" && e.content)
        .map((e) => e.content)
        .join("");

      expect(secondText).toContain("42");
    }, 120000);
  });

  describe.skipIf(!hasAnthropicKey)("Skipped - No ANTHROPIC_API_KEY", () => {
    it("Claude tests require ANTHROPIC_API_KEY environment variable", () => {
      console.log("Set ANTHROPIC_API_KEY to run Claude integration tests");
    });
  });
});

// ============================================================================
// Persistence Integration Tests (Real SQLite)
// ============================================================================

describe("Persistence Integration (Real SQLite)", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  it("should create database file and persist sessions", async () => {
    const configLayer = createRealConfigLayer(tempDbPath);
    const persistenceLayer = PersistenceLive.pipe(Layer.provide(configLayer));

    const session: SessionRecord = {
      telegramChatId: 123456,
      claudeSessionId: "real-session-id-abc",
      projectPath: "/test/project",
      workingDirectory: "/test/project/src",
      lastActiveAt: Date.now(),
      contextUsagePercent: 35.5,
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;

          // Save session
          yield* persistence.saveSession(session);

          // Verify database file was created
          expect(fs.existsSync(tempDbPath)).toBe(true);

          // Retrieve and verify
          const retrieved = yield* persistence.getSession(123456);
          expect(retrieved).not.toBeNull();
          expect(retrieved?.claudeSessionId).toBe("real-session-id-abc");
          expect(retrieved?.projectPath).toBe("/test/project");
          expect(retrieved?.contextUsagePercent).toBe(35.5);
        }).pipe(Effect.provide(persistenceLayer))
      )
    );
  });

  it("should persist data across separate connections", async () => {
    const configLayer = createRealConfigLayer(tempDbPath);

    const session: SessionRecord = {
      telegramChatId: 999,
      claudeSessionId: "persistent-across-connections",
      projectPath: null,
      workingDirectory: "/workspace",
      lastActiveAt: Date.now(),
      contextUsagePercent: 50,
    };

    // First connection - save
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
        }).pipe(Effect.provide(PersistenceLive.pipe(Layer.provide(configLayer))))
      )
    );

    // Second connection - retrieve
    const retrieved = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          return yield* persistence.getSession(999);
        }).pipe(Effect.provide(PersistenceLive.pipe(Layer.provide(configLayer))))
      )
    );

    expect(retrieved).not.toBeNull();
    expect(retrieved?.claudeSessionId).toBe("persistent-across-connections");
  });
});

// ============================================================================
// Full Conversation Flow Tests (Real Claude + Real Persistence)
// ============================================================================

describe.runIf(hasAnthropicKey)("Full Conversation Flow", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  it("should create session, call Claude, and persist session ID", async () => {
    const configLayer = createRealConfigLayer(tempDbPath);
    const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));
    const persistenceLayer = PersistenceLive.pipe(Layer.provide(configLayer));

    // First, call Claude and get the session ID
    const events: ClaudeEvent[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const claude = yield* ClaudeSession;

          const stream = claude.sendMessage({
            prompt: "Say 'test successful' and nothing else.",
            cwd: os.tmpdir(),
          });

          yield* Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              events.push(event);
            })
          );
        }).pipe(Effect.provide(claudeLayer))
      )
    );

    const sessionId = events.find((e) => e.sessionId)?.sessionId;
    const usage = events.find((e) => e.usage)?.usage;

    expect(sessionId).toBeDefined();
    expect(usage).toBeDefined();

    // Now save to persistence
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;

          const contextPercent = usage
            ? ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100
            : 0;

          yield* persistence.saveSession({
            telegramChatId: 12345,
            claudeSessionId: sessionId!,
            projectPath: null,
            workingDirectory: os.tmpdir(),
            lastActiveAt: Date.now(),
            contextUsagePercent: contextPercent,
          });

          const savedSession = yield* persistence.getSession(12345);
          expect(savedSession?.claudeSessionId).toBe(sessionId);
          expect(savedSession?.contextUsagePercent).toBeGreaterThan(0);
        }).pipe(Effect.provide(persistenceLayer))
      )
    );
  }, 60000);

  it("should maintain conversation context across multiple messages", async () => {
    const configLayer = createRealConfigLayer(tempDbPath);
    const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));
    const persistenceLayer = PersistenceLive.pipe(Layer.provide(configLayer));

    // First message
    const firstEvents: ClaudeEvent[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const claude = yield* ClaudeSession;

          const stream = claude.sendMessage({
            prompt: "I'm going to tell you a secret code: ALPHA-BRAVO-CHARLIE. Please acknowledge.",
            cwd: os.tmpdir(),
          });

          yield* Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              firstEvents.push(event);
            })
          );
        }).pipe(Effect.provide(claudeLayer))
      )
    );

    const sessionId = firstEvents.find((e) => e.sessionId)?.sessionId;
    expect(sessionId).toBeDefined();

    // Save session
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;

          yield* persistence.saveSession({
            telegramChatId: 54321,
            claudeSessionId: sessionId!,
            projectPath: null,
            workingDirectory: os.tmpdir(),
            lastActiveAt: Date.now(),
            contextUsagePercent: 10,
          });
        }).pipe(Effect.provide(persistenceLayer))
      )
    );

    // Second message - resume session
    const responses: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const claude = yield* ClaudeSession;

          const stream = claude.sendMessage({
            prompt: "What was the secret code I told you? Reply with just the code.",
            cwd: os.tmpdir(),
            resumeSessionId: sessionId,
          });

          yield* Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              if (event.type === "text" && event.content) {
                responses.push(event.content);
              }
            })
          );
        }).pipe(Effect.provide(claudeLayer))
      )
    );

    const fullResponse = responses.join("");
    expect(fullResponse).toContain("ALPHA");
    expect(fullResponse).toContain("BRAVO");
    expect(fullResponse).toContain("CHARLIE");
  }, 120000);

  it("should track context usage and warn at threshold", async () => {
    const configLayer = createRealConfigLayer(tempDbPath);
    const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));
    const persistenceLayer = PersistenceLive.pipe(Layer.provide(configLayer));

    const events: ClaudeEvent[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const claude = yield* ClaudeSession;

          const stream = claude.sendMessage({
            prompt: "Write a brief haiku about coding.",
            cwd: os.tmpdir(),
          });

          yield* Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              events.push(event);
            })
          );
        }).pipe(Effect.provide(claudeLayer))
      )
    );

    const sessionId = events.find((e) => e.sessionId)?.sessionId;
    const usage = events.find((e) => e.usage)?.usage;

    expect(sessionId).toBeDefined();

    const contextPercent = usage
      ? ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100
      : 0;

    // Save and verify
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;

          yield* persistence.saveSession({
            telegramChatId: 11111,
            claudeSessionId: sessionId!,
            projectPath: null,
            workingDirectory: os.tmpdir(),
            lastActiveAt: Date.now(),
            contextUsagePercent: contextPercent,
          });

          const session = yield* persistence.getSession(11111);
          expect(session?.contextUsagePercent).toBeGreaterThanOrEqual(0);
        }).pipe(Effect.provide(persistenceLayer))
      )
    );

    // Test formatter warning
    await Effect.runPromise(
      Effect.gen(function* () {
        const formatter = yield* MessageFormatter;
        const warning = formatter.formatContextWarning(85);
        expect(warning).toContain("85%");
        expect(warning).toContain("continuation");
      }).pipe(Effect.provide(MessageFormatterLive))
    );
  }, 60000);
});

// ============================================================================
// Telegram Integration Tests (Real API)
// ============================================================================

describe.runIf(hasTelegramCredentials)("Telegram API Integration", () => {
  // Test Telegram directly using Telegraf API (bypassing our service layer finalizers)
  it("should send a message via real Telegram API", async () => {
    const { Telegraf } = await import("telegraf");

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
    const userId = parseInt(process.env.TELEGRAM_USER_ID!, 10);

    const result = await bot.telegram.sendMessage(
      userId,
      `[E2E Test] Test message sent at ${new Date().toISOString()}`
    );

    expect(result.message_id).toBeDefined();
    expect(result.text).toContain("[E2E Test]");
  }, 30000);

  it("should send typing indicator", async () => {
    const { Telegraf } = await import("telegraf");

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
    const userId = parseInt(process.env.TELEGRAM_USER_ID!, 10);

    await expect(
      bot.telegram.sendChatAction(userId, "typing")
    ).resolves.toBe(true);
  }, 30000);

  it("should edit a message", async () => {
    const { Telegraf } = await import("telegraf");

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
    const userId = parseInt(process.env.TELEGRAM_USER_ID!, 10);

    // Send initial message
    const sent = await bot.telegram.sendMessage(userId, "[E2E Test] Original message");

    // Edit it
    const edited = await bot.telegram.editMessageText(
      userId,
      sent.message_id,
      undefined,
      "[E2E Test] Edited message"
    );

    expect(edited).toBeDefined();
  }, 30000);
});

// ============================================================================
// Full E2E Test (Claude + Telegram + Persistence)
// ============================================================================

describe.runIf(hasAnthropicKey && hasTelegramCredentials)("Full E2E: Claude + Telegram", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  it("should process a message through Claude and send response via Telegram", async () => {
    const { Telegraf } = await import("telegraf");

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
    const userId = parseInt(process.env.TELEGRAM_USER_ID!, 10);

    const configLayer = createRealConfigLayer(tempDbPath);
    const claudeLayer = ClaudeSessionLive.pipe(Layer.provide(configLayer));
    const persistenceLayer = PersistenceLive.pipe(Layer.provide(configLayer));

    // Send initial notification via Telegram
    await bot.telegram.sendMessage(userId, "[E2E Test] Starting full integration test...");
    await bot.telegram.sendChatAction(userId, "typing");

    // Call Claude and collect events
    const events: ClaudeEvent[] = [];
    let responseText = "";

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const claude = yield* ClaudeSession;

          const stream = claude.sendMessage({
            prompt: "Reply with exactly: 'E2E test successful!' and nothing else.",
            cwd: os.tmpdir(),
          });

          yield* Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              events.push(event);
              if (event.type === "text" && event.content) {
                responseText += event.content;
              }
            })
          );
        }).pipe(Effect.provide(claudeLayer))
      )
    );

    const sessionId = events.find((e) => e.sessionId)?.sessionId;
    expect(sessionId).toBeDefined();

    // Send Claude's response via Telegram
    if (responseText.trim()) {
      await bot.telegram.sendMessage(userId, responseText);
    }

    // Save session to persistence
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence;

          yield* persistence.saveSession({
            telegramChatId: userId,
            claudeSessionId: sessionId!,
            projectPath: null,
            workingDirectory: os.tmpdir(),
            lastActiveAt: Date.now(),
            contextUsagePercent: 5,
          });

          const savedSession = yield* persistence.getSession(userId);
          expect(savedSession?.claudeSessionId).toBe(sessionId);
        }).pipe(Effect.provide(persistenceLayer))
      )
    );

    // Send completion message
    await bot.telegram.sendMessage(userId, "[E2E Test] Integration test completed successfully!");
  }, 120000);
});
