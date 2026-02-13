/**
 * Message Repository
 *
 * Handles all message storage operations using SQLite with encryption.
 * Follows the repository pattern for separation from business logic.
 */

import { Context, Effect, Layer } from "effect";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { Message, EncryptedPayload } from "@maslow/shared";
import { encrypt, decrypt, generateLocalKey, keyToBase64, base64ToKey } from "@maslow/shared";
import { ConfigService } from "../Config.js";

export interface MessageRepositoryService {
  saveMessage(message: Message): Effect.Effect<void>;
  getMessages(projectId: string | null, limit: number, offset: number): Effect.Effect<Message[]>;
}

export class MessageRepository extends Context.Tag("MessageRepository")<
  MessageRepository,
  MessageRepositoryService
>() {}

export const MessageRepositoryLive = Layer.scoped(
  MessageRepository,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const dbDir = path.dirname(config.database.path);
    const dbPath = path.join(dbDir, "app.db");
    const keyPath = path.join(dbDir, ".key");

    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Ensure database is properly closed
    yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));

    // Setup encryption key
    let encryptionKey: Uint8Array;
    if (fs.existsSync(keyPath)) {
      const keyData = fs.readFileSync(keyPath, "utf8");
      encryptionKey = base64ToKey(keyData);
    } else {
      encryptionKey = generateLocalKey();
      fs.writeFileSync(keyPath, keyToBase64(encryptionKey), { mode: 0o600 });
    }

    // Prepared statements
    const stmts = {
      saveMessage: db.prepare(`
        INSERT OR REPLACE INTO messages (id, project_id, role, content, timestamp, metadata, conversation_id, encrypted)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `),

      getMessages: db.prepare(`
        SELECT * FROM messages
        WHERE (project_id = ? OR (? IS NULL AND project_id IS NULL))
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `),

      getMessagesAll: db.prepare(`
        SELECT * FROM messages
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `),
    };

    return {
      saveMessage: (message) =>
        Effect.sync(() => {
          const payload = encrypt(message.content, encryptionKey);
          const encryptedContent = JSON.stringify(payload);
          stmts.saveMessage.run(
            message.id,
            message.projectId,
            message.role,
            encryptedContent,
            message.timestamp,
            message.metadata ? JSON.stringify(message.metadata) : null,
            message.conversationId ?? null
          );
        }),

      getMessages: (projectId, limit, offset) =>
        Effect.sync(() => {
          const rows = projectId === null
            ? stmts.getMessagesAll.all(limit, offset) as Record<string, unknown>[]
            : stmts.getMessages.all(projectId, projectId, limit, offset) as Record<string, unknown>[];

          return rows.map((r) => {
            let content = r.content as string;
            if (r.encrypted) {
              try {
                const payload = JSON.parse(content) as EncryptedPayload;
                content = decrypt(payload, encryptionKey);
              } catch {
                // Fallback: if decryption fails, return raw content
              }
            }
            return {
              id: r.id as string,
              projectId: r.project_id as string | null,
              conversationId: (r.conversation_id as string) || undefined,
              role: r.role as "user" | "assistant",
              content,
              timestamp: r.timestamp as number,
              metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
            };
          });
        }),
    };
  })
  );