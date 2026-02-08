/**
 * App Persistence Service
 *
 * SQLite storage for messages, projects, documents, kanban cards, and decisions.
 * Extends the existing Persistence service with app-specific schemas.
 */

import { Context, Effect, Layer } from "effect";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ConfigService } from "./Config.js";
import {
  encrypt,
  decrypt,
  generateLocalKey,
  keyToBase64,
  base64ToKey,
  type EncryptedPayload,
} from "@maslow/shared";

export interface AppMessage {
  id: string;
  projectId: string | null;
  conversationId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AppProject {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "paused";
  createdAt: number;
  updatedAt: number;
  color?: string;
}

export interface AppProjectDocument {
  id: string;
  projectId: string;
  type: "brief" | "instructions" | "reference" | "decisions" | "assumptions" | "state";
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppDecision {
  id: string;
  projectId: string;
  title: string;
  description: string;
  alternatives: string[];
  reasoning: string;
  tradeoffs: string;
  createdAt: number;
  revisedAt?: number;
}

export type AgentType = "claude" | "codex" | "gemini";
export type AgentStatus = "idle" | "running" | "blocked" | "completed" | "failed";

export interface AppKanbanCard {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: "backlog" | "in_progress" | "done";
  labels: string[];
  dueDate?: number;
  linkedDecisionIds: string[];
  linkedMessageIds: string[];
  position: number;
  priority: number;
  contextSnapshot: string | null;
  lastSessionId: string | null;
  assignedAgent: AgentType | null;
  agentStatus: AgentStatus | null;
  blockedReason: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type CorrectionDomain = "code-pattern" | "communication" | "architecture" | "preference" | "style" | "process"
export type CorrectionSource = "explicit" | "pr-rejection" | "edit-delta" | "agent-feedback"

export interface SteeringCorrection {
  id: string
  correction: string
  domain: CorrectionDomain
  source: CorrectionSource
  context: string | null
  projectId: string | null
  active: boolean
  createdAt: number
}

export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  detail: string | null
  timestamp: number
}

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  limit?: number
  offset?: number
}

export interface AppConversation {
  id: string;
  projectId: string | null;
  claudeSessionId: string;
  status: "active" | "archived";
  contextUsagePercent: number;
  summary: string | null;
  messageCount: number;
  firstMessageAt: number;
  lastMessageAt: number;
}

export interface AppPersistenceService {
  // Messages
  saveMessage(message: AppMessage): Effect.Effect<void>;
  getMessages(projectId: string | null, limit: number, offset: number): Effect.Effect<AppMessage[]>;

  // Conversations
  getActiveConversation(projectId: string | null): Effect.Effect<AppConversation | null>;
  createConversation(projectId: string | null): Effect.Effect<AppConversation>;
  updateConversationSession(id: string, claudeSessionId: string): Effect.Effect<void>;
  updateConversationContext(id: string, percent: number): Effect.Effect<void>;
  archiveConversation(id: string, summary: string): Effect.Effect<void>;
  getRecentConversations(projectId: string | null, limit: number): Effect.Effect<AppConversation[]>;
  incrementMessageCount(id: string): Effect.Effect<void>;

  // Projects
  getProjects(): Effect.Effect<AppProject[]>;
  getProject(id: string): Effect.Effect<AppProject | null>;
  createProject(name: string, description: string): Effect.Effect<AppProject>;
  updateProject(id: string, updates: Partial<Pick<AppProject, "name" | "description" | "status" | "color">>): Effect.Effect<void>;

  // Project Documents
  getProjectDocuments(projectId: string): Effect.Effect<AppProjectDocument[]>;
  getProjectDocument(id: string): Effect.Effect<AppProjectDocument | null>;
  createProjectDocument(projectId: string, type: AppProjectDocument["type"], title: string, content: string): Effect.Effect<AppProjectDocument>;
  updateProjectDocument(id: string, updates: Partial<Pick<AppProjectDocument, "title" | "content">>): Effect.Effect<void>;

  // Kanban Cards
  getCards(projectId: string): Effect.Effect<AppKanbanCard[]>;
  getCard(id: string): Effect.Effect<AppKanbanCard | null>;
  createCard(projectId: string, title: string, description: string, column?: string): Effect.Effect<AppKanbanCard>;
  updateCard(id: string, updates: Partial<{ title: string; description: string; column: string; labels: string[]; dueDate: number; position: number }>): Effect.Effect<void>;
  deleteCard(id: string): Effect.Effect<void>;
  moveCard(id: string, column: string, position: number): Effect.Effect<void>;

  // Kanban work queue
  getNextCard(projectId: string): Effect.Effect<AppKanbanCard | null>;
  saveCardContext(id: string, snapshot: string, sessionId?: string): Effect.Effect<void>;
  assignCardAgent(id: string, agent: AgentType): Effect.Effect<void>;
  updateCardAgentStatus(id: string, status: AgentStatus, reason?: string): Effect.Effect<void>;
  startCard(id: string): Effect.Effect<void>;
  completeCard(id: string): Effect.Effect<void>;
  skipCardToBack(id: string, projectId: string): Effect.Effect<void>;

  // Steering corrections
  addCorrection(correction: string, domain: CorrectionDomain, source: CorrectionSource, context?: string, projectId?: string): Effect.Effect<SteeringCorrection>
  getCorrections(opts?: { domain?: CorrectionDomain; projectId?: string | null; activeOnly?: boolean }): Effect.Effect<SteeringCorrection[]>
  deactivateCorrection(id: string): Effect.Effect<void>
  reactivateCorrection(id: string): Effect.Effect<void>
  deleteCorrection(id: string): Effect.Effect<void>

  // Audit log
  getAuditLog(filters: AuditLogFilters): Effect.Effect<{ items: AuditEntry[]; total: number }>

  // Decisions
  getDecisions(projectId: string): Effect.Effect<AppDecision[]>;
  getDecision(id: string): Effect.Effect<AppDecision | null>;
  createDecision(projectId: string, title: string, description: string, alternatives: string[], reasoning: string, tradeoffs: string): Effect.Effect<AppDecision>;
  updateDecision(id: string, updates: Partial<{ title: string; description: string; alternatives: string[]; reasoning: string; tradeoffs: string }>): Effect.Effect<void>;
}

export class AppPersistence extends Context.Tag("AppPersistence")<
  AppPersistence,
  AppPersistenceService
>() {}

export const AppPersistenceLive = Layer.scoped(
  AppPersistence,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const dbDir = path.dirname(config.database.path);
    const dbPath = path.join(dbDir, "app.db");

    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Initialize schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'paused')),
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('brief', 'instructions', 'reference', 'decisions', 'assumptions', 'state')),
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_project_docs ON project_documents(project_id, type);

      CREATE TABLE IF NOT EXISTS kanban_cards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        "column" TEXT NOT NULL DEFAULT 'backlog' CHECK("column" IN ('backlog', 'in_progress', 'done')),
        labels TEXT NOT NULL DEFAULT '[]',
        due_date INTEGER,
        linked_decision_ids TEXT NOT NULL DEFAULT '[]',
        linked_message_ids TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kanban_project ON kanban_cards(project_id, "column", position);

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        alternatives TEXT NOT NULL DEFAULT '[]',
        reasoning TEXT NOT NULL DEFAULT '',
        tradeoffs TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        revised_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, created_at DESC);

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

      CREATE TABLE IF NOT EXISTS steering_corrections (
        id TEXT PRIMARY KEY,
        correction TEXT NOT NULL,
        domain TEXT NOT NULL CHECK(domain IN ('code-pattern', 'communication', 'architecture', 'preference', 'style', 'process')),
        source TEXT NOT NULL CHECK(source IN ('explicit', 'pr-rejection', 'edit-delta', 'agent-feedback')),
        context TEXT,
        project_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_steering_active ON steering_corrections(active, domain);
      CREATE INDEX IF NOT EXISTS idx_steering_project ON steering_corrections(project_id, active);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
    `);

    // Migration: add conversation_id to messages if not present
    const messageColumns = db.pragma("table_info(messages)") as Array<{ name: string }>;
    if (!messageColumns.some((c) => c.name === "conversation_id")) {
      db.exec(`ALTER TABLE messages ADD COLUMN conversation_id TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp DESC)`);
    }

    // Migration: add encrypted column to messages
    if (!messageColumns.some((c) => c.name === "encrypted")) {
      db.exec(`ALTER TABLE messages ADD COLUMN encrypted INTEGER DEFAULT 0`);
    }

    // Migration: add agent orchestration fields to kanban_cards
    const cardColumns = db.pragma("table_info(kanban_cards)") as Array<{ name: string }>;
    if (!cardColumns.some((c) => c.name === "priority")) {
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN context_snapshot TEXT`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN last_session_id TEXT`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN assigned_agent TEXT`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN agent_status TEXT`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN blocked_reason TEXT`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN started_at INTEGER`);
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN completed_at INTEGER`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_priority ON kanban_cards(project_id, "column", priority, position)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_agent ON kanban_cards(assigned_agent, agent_status)`);
    }

    // Load or generate local encryption key
    const keyPath = path.join(dbDir, "encryption.key");
    let encryptionKey: Uint8Array;
    if (fs.existsSync(keyPath)) {
      const keyData = fs.readFileSync(keyPath, "utf8").trim();
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
      getProjects: db.prepare(`
        SELECT * FROM projects ORDER BY updated_at DESC
      `),
      getProject: db.prepare(`
        SELECT * FROM projects WHERE id = ?
      `),
      createProject: db.prepare(`
        INSERT INTO projects (id, name, description, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `),
      updateProject: db.prepare(`
        UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
        status = COALESCE(?, status), color = COALESCE(?, color), updated_at = ?
        WHERE id = ?
      `),
      getProjectDocuments: db.prepare(`
        SELECT * FROM project_documents WHERE project_id = ? ORDER BY type, updated_at DESC
      `),
      getProjectDocument: db.prepare(`
        SELECT * FROM project_documents WHERE id = ?
      `),
      createProjectDocument: db.prepare(`
        INSERT INTO project_documents (id, project_id, type, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      updateProjectDocument: db.prepare(`
        UPDATE project_documents SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = ?
        WHERE id = ?
      `),
      getCards: db.prepare(`
        SELECT * FROM kanban_cards WHERE project_id = ? ORDER BY "column", position
      `),
      getCard: db.prepare(`
        SELECT * FROM kanban_cards WHERE id = ?
      `),
      createCard: db.prepare(`
        INSERT INTO kanban_cards (id, project_id, title, description, "column", labels, linked_decision_ids, linked_message_ids, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?, ?)
      `),
      updateCard: db.prepare(`
        UPDATE kanban_cards SET title = COALESCE(?, title), description = COALESCE(?, description),
        "column" = COALESCE(?, "column"), labels = COALESCE(?, labels),
        due_date = COALESCE(?, due_date), position = COALESCE(?, position), updated_at = ?
        WHERE id = ?
      `),
      deleteCard: db.prepare(`
        DELETE FROM kanban_cards WHERE id = ?
      `),
      moveCard: db.prepare(`
        UPDATE kanban_cards SET "column" = ?, position = ?, updated_at = ? WHERE id = ?
      `),
      getMaxCardPosition: db.prepare(`
        SELECT MAX(position) as max_pos FROM kanban_cards WHERE project_id = ? AND "column" = ?
      `),
      getNextCard: db.prepare(`
        SELECT * FROM kanban_cards
        WHERE project_id = ? AND "column" = 'backlog'
        ORDER BY priority ASC, position ASC
        LIMIT 1
      `),
      saveCardContext: db.prepare(`
        UPDATE kanban_cards SET context_snapshot = ?, last_session_id = ?, updated_at = ? WHERE id = ?
      `),
      assignCardAgent: db.prepare(`
        UPDATE kanban_cards SET assigned_agent = ?, agent_status = 'running', updated_at = ? WHERE id = ?
      `),
      updateCardAgentStatus: db.prepare(`
        UPDATE kanban_cards SET agent_status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?
      `),
      startCard: db.prepare(`
        UPDATE kanban_cards SET "column" = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?
      `),
      completeCard: db.prepare(`
        UPDATE kanban_cards SET "column" = 'done', agent_status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?
      `),
      getMaxBacklogPosition: db.prepare(`
        SELECT MAX(position) as max_pos FROM kanban_cards WHERE project_id = ? AND "column" = 'backlog'
      `),
      getMaxBacklogPriority: db.prepare(`
        SELECT MAX(priority) as max_pri FROM kanban_cards WHERE project_id = ? AND "column" = 'backlog'
      `),
      getDecisions: db.prepare(`
        SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC
      `),
      getDecision: db.prepare(`
        SELECT * FROM decisions WHERE id = ?
      `),
      createDecision: db.prepare(`
        INSERT INTO decisions (id, project_id, title, description, alternatives, reasoning, tradeoffs, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateDecision: db.prepare(`
        UPDATE decisions SET title = COALESCE(?, title), description = COALESCE(?, description),
        alternatives = COALESCE(?, alternatives), reasoning = COALESCE(?, reasoning),
        tradeoffs = COALESCE(?, tradeoffs), revised_at = ?
        WHERE id = ?
      `),
      // Steering corrections
      addCorrection: db.prepare(`
        INSERT INTO steering_corrections (id, correction, domain, source, context, project_id, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `),
      getCorrectionsAll: db.prepare(`
        SELECT * FROM steering_corrections WHERE active = 1 ORDER BY created_at ASC
      `),
      getCorrectionsByDomain: db.prepare(`
        SELECT * FROM steering_corrections WHERE active = 1 AND domain = ? ORDER BY created_at ASC
      `),
      getCorrectionsByProject: db.prepare(`
        SELECT * FROM steering_corrections WHERE active = 1 AND (project_id = ? OR project_id IS NULL) ORDER BY created_at ASC
      `),
      getCorrectionsByDomainAndProject: db.prepare(`
        SELECT * FROM steering_corrections WHERE active = 1 AND domain = ? AND (project_id = ? OR project_id IS NULL) ORDER BY created_at ASC
      `),
      getCorrectionsIncludeInactive: db.prepare(`
        SELECT * FROM steering_corrections ORDER BY created_at ASC
      `),
      deactivateCorrection: db.prepare(`
        UPDATE steering_corrections SET active = 0 WHERE id = ?
      `),
      reactivateCorrection: db.prepare(`
        UPDATE steering_corrections SET active = 1 WHERE id = ?
      `),
      deleteCorrection: db.prepare(`
        DELETE FROM steering_corrections WHERE id = ?
      `),

      // Conversations
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
    };

    // Register finalizer
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        db.close();
      })
    );

    const mapCardRow = (r: any): AppKanbanCard => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      description: r.description,
      column: r.column,
      labels: JSON.parse(r.labels),
      dueDate: r.due_date ?? undefined,
      linkedDecisionIds: JSON.parse(r.linked_decision_ids),
      linkedMessageIds: JSON.parse(r.linked_message_ids),
      position: r.position,
      priority: r.priority ?? 0,
      contextSnapshot: r.context_snapshot ?? null,
      lastSessionId: r.last_session_id ?? null,
      assignedAgent: r.assigned_agent ?? null,
      agentStatus: r.agent_status ?? null,
      blockedReason: r.blocked_reason ?? null,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

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

      // Conversations
      getActiveConversation: (projectId) =>
        Effect.sync(() => {
          const r = stmts.getActiveConversation.get(projectId, projectId) as Record<string, unknown> | undefined;
          if (!r) return null;
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
          };
        }),

      createConversation: (projectId) =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          stmts.createConversation.run(id, projectId, now, now);
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
          };
        }),

      updateConversationSession: (id, claudeSessionId) =>
        Effect.sync(() => {
          stmts.updateConversationSession.run(claudeSessionId, Date.now(), id);
        }),

      updateConversationContext: (id, percent) =>
        Effect.sync(() => {
          stmts.updateConversationContext.run(percent, Date.now(), id);
        }),

      archiveConversation: (id, summary) =>
        Effect.sync(() => {
          stmts.archiveConversation.run(summary, Date.now(), id);
        }),

      getRecentConversations: (projectId, limit) =>
        Effect.sync(() => {
          const rows = stmts.getRecentConversations.all(projectId, projectId, limit) as Record<string, unknown>[];
          return rows.map((r) => ({
            id: r.id as string,
            projectId: r.project_id as string | null,
            claudeSessionId: r.claude_session_id as string,
            status: r.status as "active" | "archived",
            contextUsagePercent: r.context_usage_percent as number,
            summary: r.summary as string | null,
            messageCount: r.message_count as number,
            firstMessageAt: r.first_message_at as number,
            lastMessageAt: r.last_message_at as number,
          }));
        }),

      incrementMessageCount: (id) =>
        Effect.sync(() => {
          stmts.incrementMessageCount.run(Date.now(), id);
        }),

      getProjects: () =>
        Effect.sync(() => {
          const rows = stmts.getProjects.all() as any[];
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            color: r.color || undefined,
          }));
        }),

      getProject: (id) =>
        Effect.sync(() => {
          const r = stmts.getProject.get(id) as any;
          if (!r) return null;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            color: r.color || undefined,
          };
        }),

      createProject: (name, description) =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          stmts.createProject.run(id, name, description, now, now);
          return {
            id,
            name,
            description,
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
          };
        }),

      updateProject: (id, updates) =>
        Effect.sync(() => {
          stmts.updateProject.run(
            updates.name ?? null,
            updates.description ?? null,
            updates.status ?? null,
            updates.color ?? null,
            Date.now(),
            id
          );
        }),

      getProjectDocuments: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getProjectDocuments.all(projectId) as any[];
          return rows.map((r) => ({
            id: r.id,
            projectId: r.project_id,
            type: r.type,
            title: r.title,
            content: r.content,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
        }),

      getProjectDocument: (id) =>
        Effect.sync(() => {
          const r = stmts.getProjectDocument.get(id) as any;
          if (!r) return null;
          return {
            id: r.id,
            projectId: r.project_id,
            type: r.type,
            title: r.title,
            content: r.content,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        }),

      createProjectDocument: (projectId, type, title, content) =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          stmts.createProjectDocument.run(id, projectId, type, title, content, now, now);
          return {
            id,
            projectId,
            type,
            title,
            content,
            createdAt: now,
            updatedAt: now,
          };
        }),

      updateProjectDocument: (id, updates) =>
        Effect.sync(() => {
          stmts.updateProjectDocument.run(
            updates.title ?? null,
            updates.content ?? null,
            Date.now(),
            id
          );
        }),

      getCards: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getCards.all(projectId) as any[];
          return rows.map(mapCardRow);
        }),

      getCard: (id) =>
        Effect.sync(() => {
          const r = stmts.getCard.get(id) as any;
          if (!r) return null;
          return mapCardRow(r);
        }),

      createCard: (projectId, title, description, column = "backlog") =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          const maxRow = stmts.getMaxCardPosition.get(projectId, column) as any;
          const position = (maxRow?.max_pos ?? -1) + 1;
          stmts.createCard.run(id, projectId, title, description, column, position, now, now);
          return {
            id,
            projectId,
            title,
            description,
            column: column as AppKanbanCard["column"],
            labels: [],
            linkedDecisionIds: [],
            linkedMessageIds: [],
            position,
            priority: 0,
            contextSnapshot: null,
            lastSessionId: null,
            assignedAgent: null,
            agentStatus: null,
            blockedReason: null,
            startedAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          };
        }),

      updateCard: (id, updates) =>
        Effect.sync(() => {
          stmts.updateCard.run(
            updates.title ?? null,
            updates.description ?? null,
            updates.column ?? null,
            updates.labels ? JSON.stringify(updates.labels) : null,
            updates.dueDate ?? null,
            updates.position ?? null,
            Date.now(),
            id
          );
        }),

      deleteCard: (id) =>
        Effect.sync(() => {
          stmts.deleteCard.run(id);
        }),

      moveCard: (id, column, position) =>
        Effect.sync(() => {
          stmts.moveCard.run(column, position, Date.now(), id);
        }),

      getNextCard: (projectId) =>
        Effect.sync(() => {
          const r = stmts.getNextCard.get(projectId) as any;
          if (!r) return null;
          return mapCardRow(r);
        }),

      saveCardContext: (id, snapshot, sessionId) =>
        Effect.sync(() => {
          stmts.saveCardContext.run(snapshot, sessionId ?? null, Date.now(), id);
        }),

      assignCardAgent: (id, agent) =>
        Effect.sync(() => {
          stmts.assignCardAgent.run(agent, Date.now(), id);
        }),

      updateCardAgentStatus: (id, status, reason) =>
        Effect.sync(() => {
          stmts.updateCardAgentStatus.run(status, reason ?? null, Date.now(), id);
        }),

      startCard: (id) =>
        Effect.sync(() => {
          const now = Date.now();
          stmts.startCard.run(now, now, id);
        }),

      completeCard: (id) =>
        Effect.sync(() => {
          const now = Date.now();
          stmts.completeCard.run(now, now, id);
        }),

      skipCardToBack: (id, projectId) =>
        Effect.sync(() => {
          const maxPos = stmts.getMaxBacklogPosition.get(projectId) as any;
          const maxPri = stmts.getMaxBacklogPriority.get(projectId) as any;
          const now = Date.now();
          stmts.moveCard.run("backlog", (maxPos?.max_pos ?? 0) + 1, now, id);
          stmts.updateCardAgentStatus.run("idle", null, now, id);
          // Set priority to max + 1 so it goes to the end
          db.prepare(`UPDATE kanban_cards SET priority = ?, assigned_agent = NULL WHERE id = ?`)
            .run((maxPri?.max_pri ?? 0) + 1, id);
        }),

      addCorrection: (correction, domain, source, context, projectId) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = Date.now()
          stmts.addCorrection.run(id, correction, domain, source, context ?? null, projectId ?? null, now)
          return {
            id,
            correction,
            domain,
            source,
            context: context ?? null,
            projectId: projectId ?? null,
            active: true,
            createdAt: now,
          }
        }),

      getCorrections: (opts) =>
        Effect.sync(() => {
          const domain = opts?.domain
          const projectId = opts?.projectId
          const activeOnly = opts?.activeOnly ?? true

          let rows: Record<string, unknown>[]
          if (!activeOnly) {
            rows = stmts.getCorrectionsIncludeInactive.all() as Record<string, unknown>[]
          } else if (domain && projectId !== undefined) {
            rows = stmts.getCorrectionsByDomainAndProject.all(domain, projectId) as Record<string, unknown>[]
          } else if (domain) {
            rows = stmts.getCorrectionsByDomain.all(domain) as Record<string, unknown>[]
          } else if (projectId !== undefined) {
            rows = stmts.getCorrectionsByProject.all(projectId) as Record<string, unknown>[]
          } else {
            rows = stmts.getCorrectionsAll.all() as Record<string, unknown>[]
          }

          return rows.map((r) => ({
            id: r.id as string,
            correction: r.correction as string,
            domain: r.domain as CorrectionDomain,
            source: r.source as CorrectionSource,
            context: r.context as string | null,
            projectId: r.project_id as string | null,
            active: (r.active as number) === 1,
            createdAt: r.created_at as number,
          }))
        }),

      deactivateCorrection: (id) =>
        Effect.sync(() => {
          stmts.deactivateCorrection.run(id)
        }),

      reactivateCorrection: (id) =>
        Effect.sync(() => {
          stmts.reactivateCorrection.run(id)
        }),

      deleteCorrection: (id) =>
        Effect.sync(() => {
          stmts.deleteCorrection.run(id)
        }),

      getAuditLog: (filters) =>
        Effect.sync(() => {
          const conditions: string[] = []
          const params: unknown[] = []

          if (filters.entityType) {
            conditions.push("entity_type = ?")
            params.push(filters.entityType)
          }
          if (filters.entityId) {
            conditions.push("entity_id = ?")
            params.push(filters.entityId)
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
          const limit = filters.limit ?? 50
          const offset = filters.offset ?? 0

          const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params) as { cnt: number }
          const total = countRow.cnt

          const rows = db.prepare(
            `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
          ).all(...params, limit, offset) as Array<Record<string, unknown>>

          const items: AuditEntry[] = rows.map((r) => ({
            id: r.id as string,
            entityType: r.entity_type as string,
            entityId: r.entity_id as string,
            action: r.action as string,
            detail: r.detail as string | null,
            timestamp: r.timestamp as number,
          }))

          return { items, total }
        }),

      getDecisions: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getDecisions.all(projectId) as any[];
          return rows.map((r) => ({
            id: r.id,
            projectId: r.project_id,
            title: r.title,
            description: r.description,
            alternatives: JSON.parse(r.alternatives),
            reasoning: r.reasoning,
            tradeoffs: r.tradeoffs,
            createdAt: r.created_at,
            revisedAt: r.revised_at ?? undefined,
          }));
        }),

      getDecision: (id) =>
        Effect.sync(() => {
          const r = stmts.getDecision.get(id) as any;
          if (!r) return null;
          return {
            id: r.id,
            projectId: r.project_id,
            title: r.title,
            description: r.description,
            alternatives: JSON.parse(r.alternatives),
            reasoning: r.reasoning,
            tradeoffs: r.tradeoffs,
            createdAt: r.created_at,
            revisedAt: r.revised_at ?? undefined,
          };
        }),

      createDecision: (projectId, title, description, alternatives, reasoning, tradeoffs) =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          stmts.createDecision.run(id, projectId, title, description, JSON.stringify(alternatives), reasoning, tradeoffs, now);
          return {
            id,
            projectId,
            title,
            description,
            alternatives,
            reasoning,
            tradeoffs,
            createdAt: now,
          };
        }),

      updateDecision: (id, updates) =>
        Effect.sync(() => {
          stmts.updateDecision.run(
            updates.title ?? null,
            updates.description ?? null,
            updates.alternatives ? JSON.stringify(updates.alternatives) : null,
            updates.reasoning ?? null,
            updates.tradeoffs ?? null,
            Date.now(),
            id
          );
        }),
    };
  })
);
