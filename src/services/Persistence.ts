/**
 * Persistence Service
 *
 * SQLite-based storage for chat-to-session mapping and metadata.
 */

import { Context, Effect, Layer } from "effect";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { ConfigService } from "./Config.js";

export interface SessionRecord {
  telegramChatId: number;
  claudeSessionId: string;
  projectPath: string | null;
  workingDirectory: string;
  lastActiveAt: number;
  contextUsagePercent: number;
}

export interface PersistenceService {
  getSession(telegramChatId: number): Effect.Effect<SessionRecord | null>;
  saveSession(record: SessionRecord): Effect.Effect<void>;
  updateLastActive(telegramChatId: number): Effect.Effect<void>;
  updateContextUsage(
    telegramChatId: number,
    percent: number
  ): Effect.Effect<void>;
  deleteSession(telegramChatId: number): Effect.Effect<void>;
  getLastActiveChatId(): Effect.Effect<number | null>;
  close(): Effect.Effect<void>;
}

export class Persistence extends Context.Tag("Persistence")<
  Persistence,
  PersistenceService
>() {}

export const PersistenceLive = Layer.scoped(
  Persistence,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const dbPath = config.database.path;

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath);

    // Initialize schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        telegram_chat_id INTEGER PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        project_path TEXT,
        working_directory TEXT NOT NULL,
        last_active_at INTEGER NOT NULL,
        context_usage_percent REAL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_last_active
        ON sessions(last_active_at DESC);
    `);

    const statements = {
      getSession: db.prepare<[number], {
        telegram_chat_id: number;
        claude_session_id: string;
        project_path: string | null;
        working_directory: string;
        last_active_at: number;
        context_usage_percent: number;
      }>(`
        SELECT * FROM sessions WHERE telegram_chat_id = ?
      `),

      saveSession: db.prepare(`
        INSERT OR REPLACE INTO sessions
          (telegram_chat_id, claude_session_id, project_path, working_directory, last_active_at, context_usage_percent)
        VALUES (?, ?, ?, ?, ?, ?)
      `),

      updateLastActive: db.prepare(`
        UPDATE sessions SET last_active_at = ? WHERE telegram_chat_id = ?
      `),

      updateContextUsage: db.prepare(`
        UPDATE sessions SET context_usage_percent = ? WHERE telegram_chat_id = ?
      `),

      deleteSession: db.prepare(`
        DELETE FROM sessions WHERE telegram_chat_id = ?
      `),

      getLastActiveChatId: db.prepare<[], { telegram_chat_id: number }>(`
        SELECT telegram_chat_id FROM sessions ORDER BY last_active_at DESC LIMIT 1
      `),
    };

    // Register finalizer to close database
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        db.close();
      })
    );

    return {
      getSession: (telegramChatId: number) =>
        Effect.sync(() => {
          const row = statements.getSession.get(telegramChatId);
          if (!row) return null;
          return {
            telegramChatId: row.telegram_chat_id,
            claudeSessionId: row.claude_session_id,
            projectPath: row.project_path,
            workingDirectory: row.working_directory,
            lastActiveAt: row.last_active_at,
            contextUsagePercent: row.context_usage_percent,
          };
        }),

      saveSession: (record: SessionRecord) =>
        Effect.sync(() => {
          statements.saveSession.run(
            record.telegramChatId,
            record.claudeSessionId,
            record.projectPath,
            record.workingDirectory,
            record.lastActiveAt,
            record.contextUsagePercent
          );
        }),

      updateLastActive: (telegramChatId: number) =>
        Effect.sync(() => {
          statements.updateLastActive.run(Date.now(), telegramChatId);
        }),

      updateContextUsage: (telegramChatId: number, percent: number) =>
        Effect.sync(() => {
          statements.updateContextUsage.run(percent, telegramChatId);
        }),

      deleteSession: (telegramChatId: number) =>
        Effect.sync(() => {
          statements.deleteSession.run(telegramChatId);
        }),

      getLastActiveChatId: () =>
        Effect.sync(() => {
          const row = statements.getLastActiveChatId.get();
          return row?.telegram_chat_id ?? null;
        }),

      close: () =>
        Effect.sync(() => {
          db.close();
        }),
    };
  })
);
