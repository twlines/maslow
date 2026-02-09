/**
 * Conversation Repository
 *
 * Extracted from AppPersistence — owns conversation table schema,
 * prepared statements, and CRUD operations.
 *
 * Receives a Database instance from AppPersistence (shares app.db).
 */

import { Effect } from "effect"
import type Database from "better-sqlite3"
import { randomUUID } from "crypto"

export interface AppConversation {
  id: string
  projectId: string | null
  claudeSessionId: string
  status: "active" | "archived"
  contextUsagePercent: number
  summary: string | null
  messageCount: number
  firstMessageAt: number
  lastMessageAt: number
}

export interface ConversationRepositoryService {
  getActiveConversation(projectId: string | null): Effect.Effect<AppConversation | null>
  createConversation(projectId: string | null): Effect.Effect<AppConversation>
  updateConversationSession(id: string, claudeSessionId: string): Effect.Effect<void>
  updateConversationContext(id: string, percent: number): Effect.Effect<void>
  archiveConversation(id: string, summary: string): Effect.Effect<void>
  getRecentConversations(projectId: string | null, limit: number): Effect.Effect<AppConversation[]>
  incrementMessageCount(id: string): Effect.Effect<void>
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    claude_session_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    context_usage_percent REAL DEFAULT 0,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    first_message_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, status, last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(status, last_message_at DESC);
`

function mapRow(r: Record<string, unknown>): AppConversation {
  return {
    id: r.id as string,
    projectId: r.project_id as string | null,
    claudeSessionId: r.claude_session_id as string,
    status: r.status as "active" | "archived",
    contextUsagePercent: r.context_usage_percent as number,
    summary: r.summary as string | null,
    messageCount: r.message_count as number,
    firstMessageAt: r.first_message_at as number,
    lastMessageAt: r.last_message_at as number,
  }
}

export function createConversationRepository(db: Database.Database): ConversationRepositoryService {
  db.exec(SCHEMA)

  const stmts = {
    getActiveConversation: db.prepare(`
      SELECT * FROM conversations
      WHERE status = 'active'
      AND (project_id = ? OR (? IS NULL AND project_id IS NULL))
      ORDER BY last_message_at DESC LIMIT 1
    `),
    createConversation: db.prepare(`
      INSERT INTO conversations (id, project_id, claude_session_id, status, context_usage_percent, message_count, first_message_at, last_message_at)
      VALUES (?, ?, '', 'active', 0, 0, ?, ?)
    `),
    updateConversationSession: db.prepare(`
      UPDATE conversations SET claude_session_id = ?, last_message_at = ? WHERE id = ?
    `),
    updateConversationContext: db.prepare(`
      UPDATE conversations SET context_usage_percent = ?, last_message_at = ? WHERE id = ?
    `),
    archiveConversation: db.prepare(`
      UPDATE conversations SET status = 'archived', summary = ?, last_message_at = ? WHERE id = ?
    `),
    getRecentConversations: db.prepare(`
      SELECT * FROM conversations
      WHERE (project_id = ? OR (? IS NULL AND project_id IS NULL))
      ORDER BY last_message_at DESC LIMIT ?
    `),
    incrementMessageCount: db.prepare(`
      UPDATE conversations SET message_count = message_count + 1, last_message_at = ? WHERE id = ?
    `),
  }

  return {
    getActiveConversation: (projectId) =>
      Effect.sync(() => {
        const r = stmts.getActiveConversation.get(projectId, projectId) as Record<string, unknown> | undefined
        if (!r) return null
        return mapRow(r)
      }),

    createConversation: (projectId) =>
      Effect.sync(() => {
        const id = randomUUID()
        const now = Date.now()
        stmts.createConversation.run(id, projectId, now, now)
        return {
          id,
          projectId,
          claudeSessionId: "",
          status: "active" as const,
          contextUsagePercent: 0,
          summary: null,
          messageCount: 0,
          firstMessageAt: now,
          lastMessageAt: now,
        }
      }),

    updateConversationSession: (id, claudeSessionId) =>
      Effect.sync(() => {
        stmts.updateConversationSession.run(claudeSessionId, Date.now(), id)
      }),

    updateConversationContext: (id, percent) =>
      Effect.sync(() => {
        stmts.updateConversationContext.run(percent, Date.now(), id)
      }),

    archiveConversation: (id, summary) =>
      Effect.sync(() => {
        stmts.archiveConversation.run(summary, Date.now(), id)
      }),

    getRecentConversations: (projectId, limit) =>
      Effect.sync(() => {
        const rows = stmts.getRecentConversations.all(projectId, projectId, limit) as Record<string, unknown>[]
        return rows.map(mapRow)
      }),

    incrementMessageCount: (id) =>
      Effect.sync(() => {
        stmts.incrementMessageCount.run(Date.now(), id)
      }),
  }
}
