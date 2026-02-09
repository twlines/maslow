/**
 * Integration Tests for Persistence Service
 *
 * Uses an in-memory SQLite database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { Persistence, PersistenceLive, type SessionRecord } from "../../services/Persistence.js";
import { ConfigService, type AppConfig } from "../../services/Config.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Create a test config layer with temp database
const createTestConfigLayer = (dbPath: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: dbPath },
  } satisfies AppConfig);

// Helper to create a temp database path
const createTempDbPath = () => {
  const tmpDir = os.tmpdir();
  const dbDir = path.join(tmpDir, "telegram-claude-test");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
};

// Helper to clean up temp database
const cleanupTempDb = (dbPath: string) => {
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {
    // Ignore cleanup errors
  }
};

describe("Persistence Service", () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  const runWithPersistence = <A>(
    effect: Effect.Effect<A, unknown, Persistence>,
    dbPath: string = tempDbPath
  ): Promise<A> => {
    const testConfigLayer = createTestConfigLayer(dbPath);
    const testLayer = PersistenceLive.pipe(Layer.provide(testConfigLayer));

    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer))
    );
  };

  describe("saveSession and getSession", () => {
    it("should save and retrieve a session", async () => {
      const session: SessionRecord = {
        telegramChatId: 123,
        claudeSessionId: "session-abc",
        projectPath: "/projects/myapp",
        workingDirectory: "/projects/myapp/src",
        lastActiveAt: Date.now(),
        contextUsagePercent: 25.5,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
          return yield* persistence.getSession(123);
        })
      );

      expect(result).not.toBeNull();
      expect(result?.telegramChatId).toBe(123);
      expect(result?.claudeSessionId).toBe("session-abc");
      expect(result?.projectPath).toBe("/projects/myapp");
      expect(result?.workingDirectory).toBe("/projects/myapp/src");
      expect(result?.contextUsagePercent).toBe(25.5);
    });

    it("should return null for non-existent session", async () => {
      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          return yield* persistence.getSession(999);
        })
      );

      expect(result).toBeNull();
    });

    it("should handle null projectPath", async () => {
      const session: SessionRecord = {
        telegramChatId: 456,
        claudeSessionId: "session-xyz",
        projectPath: null,
        workingDirectory: "/home/user",
        lastActiveAt: Date.now(),
        contextUsagePercent: 0,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
          return yield* persistence.getSession(456);
        })
      );

      expect(result?.projectPath).toBeNull();
    });

    it("should upsert existing session (INSERT OR REPLACE)", async () => {
      const session1: SessionRecord = {
        telegramChatId: 789,
        claudeSessionId: "session-v1",
        projectPath: "/v1",
        workingDirectory: "/v1",
        lastActiveAt: Date.now(),
        contextUsagePercent: 10,
      };

      const session2: SessionRecord = {
        telegramChatId: 789,
        claudeSessionId: "session-v2",
        projectPath: "/v2",
        workingDirectory: "/v2",
        lastActiveAt: Date.now() + 1000,
        contextUsagePercent: 20,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session1);
          yield* persistence.saveSession(session2);
          return yield* persistence.getSession(789);
        })
      );

      expect(result?.claudeSessionId).toBe("session-v2");
      expect(result?.projectPath).toBe("/v2");
    });
  });

  describe("updateLastActive", () => {
    it("should update last active timestamp", async () => {
      const initialTime = Date.now() - 10000;
      const session: SessionRecord = {
        telegramChatId: 111,
        claudeSessionId: "session-time",
        projectPath: null,
        workingDirectory: "/",
        lastActiveAt: initialTime,
        contextUsagePercent: 0,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
          yield* persistence.updateLastActive(111);
          return yield* persistence.getSession(111);
        })
      );

      expect(result?.lastActiveAt).toBeGreaterThan(initialTime);
    });
  });

  describe("updateContextUsage", () => {
    it("should update context usage percentage", async () => {
      const session: SessionRecord = {
        telegramChatId: 222,
        claudeSessionId: "session-usage",
        projectPath: null,
        workingDirectory: "/",
        lastActiveAt: Date.now(),
        contextUsagePercent: 10,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
          yield* persistence.updateContextUsage(222, 75.5);
          return yield* persistence.getSession(222);
        })
      );

      expect(result?.contextUsagePercent).toBe(75.5);
    });
  });

  describe("deleteSession", () => {
    it("should delete an existing session", async () => {
      const session: SessionRecord = {
        telegramChatId: 333,
        claudeSessionId: "session-delete",
        projectPath: null,
        workingDirectory: "/",
        lastActiveAt: Date.now(),
        contextUsagePercent: 0,
      };

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          yield* persistence.saveSession(session);
          yield* persistence.deleteSession(333);
          return yield* persistence.getSession(333);
        })
      );

      expect(result).toBeNull();
    });

    it("should not error when deleting non-existent session", async () => {
      await expect(
        runWithPersistence(
          Effect.gen(function* () {
            const persistence = yield* Persistence;
            yield* persistence.deleteSession(999999);
          })
        )
      ).resolves.not.toThrow();
    });
  });

  describe("getLastActiveChatId", () => {
    it("should return the most recently active chat ID", async () => {
      const now = Date.now();

      const sessions: SessionRecord[] = [
        {
          telegramChatId: 100,
          claudeSessionId: "s1",
          projectPath: null,
          workingDirectory: "/",
          lastActiveAt: now - 2000,
          contextUsagePercent: 0,
        },
        {
          telegramChatId: 200,
          claudeSessionId: "s2",
          projectPath: null,
          workingDirectory: "/",
          lastActiveAt: now, // Most recent
          contextUsagePercent: 0,
        },
        {
          telegramChatId: 300,
          claudeSessionId: "s3",
          projectPath: null,
          workingDirectory: "/",
          lastActiveAt: now - 1000,
          contextUsagePercent: 0,
        },
      ];

      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          for (const session of sessions) {
            yield* persistence.saveSession(session);
          }
          return yield* persistence.getLastActiveChatId();
        })
      );

      expect(result).toBe(200);
    });

    it("should return null when no sessions exist", async () => {
      const result = await runWithPersistence(
        Effect.gen(function* () {
          const persistence = yield* Persistence;
          return yield* persistence.getLastActiveChatId();
        })
      );

      expect(result).toBeNull();
    });
  });

  describe("database isolation", () => {
    it("should isolate sessions between different databases", async () => {
      const dbPath1 = createTempDbPath();
      const dbPath2 = createTempDbPath();

      try {
        const session: SessionRecord = {
          telegramChatId: 500,
          claudeSessionId: "isolated-session",
          projectPath: null,
          workingDirectory: "/",
          lastActiveAt: Date.now(),
          contextUsagePercent: 0,
        };

        // Save to db1
        await runWithPersistence(
          Effect.gen(function* () {
            const persistence = yield* Persistence;
            yield* persistence.saveSession(session);
          }),
          dbPath1
        );

        // Should not exist in db2
        const result = await runWithPersistence(
          Effect.gen(function* () {
            const persistence = yield* Persistence;
            return yield* persistence.getSession(500);
          }),
          dbPath2
        );

        expect(result).toBeNull();
      } finally {
        cleanupTempDb(dbPath1);
        cleanupTempDb(dbPath2);
      }
    });
  });
});
