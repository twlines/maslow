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
import { MessageRepository } from "./repositories/MessageRepository.js";
import {
  encrypt,
  decrypt,
  generateLocalKey,
  keyToBase64,
  base64ToKey,
  type EncryptedPayload,
  type Message,
  type Project,
  type ProjectDocument,
  type KanbanCard,
  type Decision,
  type Conversation,
  type AgentType,
  type AgentStatus,
  type SteeringCorrection,
  type CorrectionDomain,
  type CorrectionSource,
  type TokenUsage,
  type UsageSummary,
  type SearchResult,
  type AuditEntry,
  type AuditLogFilters,
  type VerificationStatus,
  type Campaign,
  type CampaignReport,
  type CodebaseMetrics,
  type GovernanceFlow,
  type GovernanceClause,
  type GateCriterion,
  type GovernanceSummary,
  type RiskTier,
  type MaturityLevel,
  type FlowPriority,
  type StalenessStatus,
  type GateStatus,
} from "@maslow/shared";


export interface AppPersistenceService {
  // Messages
  saveMessage(message: Message): Effect.Effect<void>;
  getMessages(projectId: string | null, limit: number, offset: number): Effect.Effect<Message[]>;

  // Conversations
  getActiveConversation(projectId: string | null): Effect.Effect<Conversation | null>;
  createConversation(projectId: string | null): Effect.Effect<Conversation>;
  updateConversationSession(id: string, claudeSessionId: string): Effect.Effect<void>;
  updateConversationContext(id: string, percent: number): Effect.Effect<void>;
  archiveConversation(id: string, summary: string): Effect.Effect<void>;
  getRecentConversations(projectId: string | null, limit: number): Effect.Effect<Conversation[]>;
  incrementMessageCount(id: string): Effect.Effect<void>;

  // Projects
  getProjects(): Effect.Effect<Project[]>;
  getProject(id: string): Effect.Effect<Project | null>;
  createProject(name: string, description: string): Effect.Effect<Project>;
  updateProject(id: string, updates: Partial<Pick<Project, "name" | "description" | "status" | "color" | "agentTimeoutMinutes" | "maxConcurrentAgents">>): Effect.Effect<void>;

  // Project Documents
  getProjectDocuments(projectId: string): Effect.Effect<ProjectDocument[]>;
  getProjectDocument(id: string): Effect.Effect<ProjectDocument | null>;
  createProjectDocument(projectId: string, type: ProjectDocument["type"], title: string, content: string): Effect.Effect<ProjectDocument>;
  updateProjectDocument(id: string, updates: Partial<Pick<ProjectDocument, "title" | "content">>): Effect.Effect<void>;

  // Kanban Cards
  getCards(projectId: string): Effect.Effect<KanbanCard[]>;
  getCard(id: string): Effect.Effect<KanbanCard | null>;
  createCard(projectId: string, title: string, description: string, column?: string): Effect.Effect<KanbanCard>;
  updateCard(id: string, updates: Partial<{ title: string; description: string; column: string; labels: string[]; dueDate: number; position: number }>): Effect.Effect<void>;
  deleteCard(id: string): Effect.Effect<void>;
  moveCard(id: string, column: string, position: number): Effect.Effect<void>;

  // Kanban work queue
  getNextCard(projectId: string): Effect.Effect<KanbanCard | null>;
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
  logAudit(entityType: string, entityId: string, action: string, details?: Record<string, unknown>, actor?: string): Effect.Effect<void>

  // Token usage
  insertTokenUsage(usage: Omit<TokenUsage, "id">): Effect.Effect<TokenUsage>

  // Decisions
  getDecisions(projectId: string): Effect.Effect<Decision[]>;
  getDecision(id: string): Effect.Effect<Decision | null>;
  createDecision(projectId: string, title: string, description: string, alternatives: string[], reasoning: string, tradeoffs: string): Effect.Effect<Decision>;
  updateDecision(id: string, updates: Partial<{ title: string; description: string; alternatives: string[]; reasoning: string; tradeoffs: string }>): Effect.Effect<void>;

  // Search
  search(query: string, projectId?: string): Effect.Effect<SearchResult[]>

  // Audit log query
  getAuditLog(filters: AuditLogFilters): Effect.Effect<{ items: AuditEntry[]; total: number }>

  // Backup
  backupDatabase(destinationPath: string): Effect.Effect<void, Error>

  // Usage
  getUsageSummary(projectId?: string, days?: number): Effect.Effect<UsageSummary>;

  // Verification
  updateCardVerification(id: string, status: VerificationStatus, output?: string): Effect.Effect<void>
  getCardsByVerificationStatus(status: VerificationStatus): Effect.Effect<KanbanCard[]>
  getCardsByCampaign(campaignId: string): Effect.Effect<KanbanCard[]>

  // Campaigns
  createCampaign(projectId: string, name: string, description: string): Effect.Effect<Campaign>
  getCampaign(id: string): Effect.Effect<Campaign | null>
  getCampaigns(projectId: string): Effect.Effect<Campaign[]>
  updateCampaign(id: string, updates: Partial<Pick<Campaign, "name" | "description" | "status" | "baselineMetrics">>): Effect.Effect<void>

  // Campaign reports
  createCampaignReport(report: Omit<CampaignReport, "id">): Effect.Effect<CampaignReport>
  getCampaignReports(campaignId: string, limit?: number): Effect.Effect<CampaignReport[]>

  // Governance
  getGovernanceFlows(projectId: string): Effect.Effect<GovernanceFlow[]>
  getGovernanceFlow(flowId: string, projectId: string): Effect.Effect<GovernanceFlow | null>
  syncGovernanceCorpus(projectId: string, corpus: { contracts: Array<Record<string, unknown>> }): Effect.Effect<{ synced: number; removed: number }>
  getGovernanceGateCriteria(projectId: string): Effect.Effect<GateCriterion[]>
  upsertGovernanceGateCriterion(criterion: GateCriterion): Effect.Effect<void>
  getGovernanceSummary(projectId: string): Effect.Effect<GovernanceSummary>
}

export class AppPersistence extends Context.Tag("AppPersistence")<
  AppPersistence,
  AppPersistenceService
>() {}

export const AppPersistenceLive = Layer.scoped(
  AppPersistence,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const messageRepo = yield* MessageRepository;
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
        actor TEXT NOT NULL DEFAULT 'system',
        details TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        card_id TEXT,
        project_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_token_usage_project ON token_usage(project_id, created_at DESC);
    `);

    // FTS5 virtual tables for full-text search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kanban_cards_fts USING fts5(
        title, description,
        content=kanban_cards, content_rowid=rowid
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS project_documents_fts USING fts5(
        title, content,
        content=project_documents, content_rowid=rowid
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
        title, description, reasoning,
        content=decisions, content_rowid=rowid
      );
    `);

    // Triggers to keep FTS tables in sync

    // kanban_cards triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS kanban_cards_ai AFTER INSERT ON kanban_cards BEGIN
        INSERT INTO kanban_cards_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;

      CREATE TRIGGER IF NOT EXISTS kanban_cards_ad AFTER DELETE ON kanban_cards BEGIN
        INSERT INTO kanban_cards_fts(kanban_cards_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
      END;

      CREATE TRIGGER IF NOT EXISTS kanban_cards_au AFTER UPDATE ON kanban_cards BEGIN
        INSERT INTO kanban_cards_fts(kanban_cards_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
        INSERT INTO kanban_cards_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;
    `);

    // project_documents triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS project_documents_ai AFTER INSERT ON project_documents BEGIN
        INSERT INTO project_documents_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS project_documents_ad AFTER DELETE ON project_documents BEGIN
        INSERT INTO project_documents_fts(project_documents_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS project_documents_au AFTER UPDATE ON project_documents BEGIN
        INSERT INTO project_documents_fts(project_documents_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO project_documents_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;
    `);

    // decisions triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
        INSERT INTO decisions_fts(rowid, title, description, reasoning)
        VALUES (new.rowid, new.title, new.description, new.reasoning);
      END;

      CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, description, reasoning)
        VALUES ('delete', old.rowid, old.title, old.description, old.reasoning);
      END;

      CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
        INSERT INTO decisions_fts(decisions_fts, rowid, title, description, reasoning)
        VALUES ('delete', old.rowid, old.title, old.description, old.reasoning);
        INSERT INTO decisions_fts(rowid, title, description, reasoning)
        VALUES (new.rowid, new.title, new.description, new.reasoning);
      END;
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

    // Migration: add verification fields to kanban_cards
    if (!cardColumns.some((c) => c.name === "verification_status")) {
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN verification_status TEXT DEFAULT 'unverified'`)
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN campaign_id TEXT`)
      db.exec(`ALTER TABLE kanban_cards ADD COLUMN verification_output TEXT`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_verification ON kanban_cards(verification_status)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_campaign ON kanban_cards(campaign_id)`)
    }

    // Create campaigns and campaign_reports tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'paused')),
        baseline_metrics TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id, status);

      CREATE TABLE IF NOT EXISTS campaign_reports (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        baseline_metrics TEXT NOT NULL,
        current_metrics TEXT NOT NULL,
        cards_completed INTEGER NOT NULL DEFAULT 0,
        cards_remaining INTEGER NOT NULL DEFAULT 0,
        cards_blocked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_reports ON campaign_reports(campaign_id, created_at DESC);
    `)

    // Governance tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS governance_flows (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        flow_name TEXT NOT NULL,
        source_file TEXT NOT NULL,
        risk_tier TEXT NOT NULL,
        maturity TEXT NOT NULL,
        priority TEXT NOT NULL,
        dimensions TEXT NOT NULL DEFAULT '[]',
        clauses TEXT NOT NULL DEFAULT '[]',
        collections TEXT NOT NULL DEFAULT '[]',
        external_services TEXT NOT NULL DEFAULT '[]',
        data_categories TEXT NOT NULL DEFAULT '[]',
        review_issue TEXT,
        hardening_issue TEXT,
        git_hash TEXT NOT NULL,
        staleness TEXT NOT NULL DEFAULT 'unknown',
        raw_contract TEXT NOT NULL DEFAULT '{}',
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (id, project_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_governance_flows_project ON governance_flows(project_id, maturity);
      CREATE INDEX IF NOT EXISTS idx_governance_flows_risk ON governance_flows(project_id, risk_tier);

      CREATE TABLE IF NOT EXISTS governance_gate_criteria (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        criterion_number INTEGER NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'fail',
        evidence TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_governance_gate_project ON governance_gate_criteria(project_id, criterion_number);
    `)

    // Migration: add agent config fields to projects
    const projectColumns = db.pragma("table_info(projects)") as Array<{ name: string }>;
    if (!projectColumns.some((c) => c.name === "agent_timeout_minutes")) {
      db.exec(`ALTER TABLE projects ADD COLUMN agent_timeout_minutes INTEGER DEFAULT 30`);
      db.exec(`ALTER TABLE projects ADD COLUMN max_concurrent_agents INTEGER DEFAULT 1`);
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
        status = COALESCE(?, status), color = COALESCE(?, color),
        agent_timeout_minutes = COALESCE(?, agent_timeout_minutes),
        max_concurrent_agents = COALESCE(?, max_concurrent_agents),
        updated_at = ?
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

      // Audit log
      insertAuditLog: db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, actor, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
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

      // Token usage
      insertTokenUsage: db.prepare(`
        INSERT INTO token_usage (id, card_id, project_id, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      // Verification
      updateCardVerification: db.prepare(`
        UPDATE kanban_cards SET verification_status = ?, verification_output = ?, updated_at = ? WHERE id = ?
      `),
      getCardsByVerificationStatus: db.prepare(`
        SELECT * FROM kanban_cards WHERE verification_status = ?
      `),
      getCardsByCampaign: db.prepare(`
        SELECT * FROM kanban_cards WHERE campaign_id = ? ORDER BY "column", priority, position
      `),

      // Campaigns
      createCampaign: db.prepare(`
        INSERT INTO campaigns (id, project_id, name, description, status, baseline_metrics, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      `),
      getCampaign: db.prepare(`
        SELECT * FROM campaigns WHERE id = ?
      `),
      getCampaigns: db.prepare(`
        SELECT * FROM campaigns WHERE project_id = ? ORDER BY created_at DESC
      `),
      updateCampaign: db.prepare(`
        UPDATE campaigns SET name = COALESCE(?, name), description = COALESCE(?, description),
        status = COALESCE(?, status), baseline_metrics = COALESCE(?, baseline_metrics), updated_at = ?
        WHERE id = ?
      `),

      // Campaign reports
      createCampaignReport: db.prepare(`
        INSERT INTO campaign_reports (id, campaign_id, baseline_metrics, current_metrics, cards_completed, cards_remaining, cards_blocked, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getCampaignReports: db.prepare(`
        SELECT * FROM campaign_reports WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?
      `),

      // Governance
      getGovernanceFlows: db.prepare(`
        SELECT * FROM governance_flows WHERE project_id = ? ORDER BY risk_tier, priority, id
      `),
      getGovernanceFlow: db.prepare(`
        SELECT * FROM governance_flows WHERE id = ? AND project_id = ?
      `),
      upsertGovernanceFlow: db.prepare(`
        INSERT INTO governance_flows (id, project_id, flow_name, source_file, risk_tier, maturity, priority, dimensions, clauses, collections, external_services, data_categories, review_issue, hardening_issue, git_hash, staleness, raw_contract, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, project_id) DO UPDATE SET
          flow_name = excluded.flow_name,
          source_file = excluded.source_file,
          risk_tier = excluded.risk_tier,
          maturity = excluded.maturity,
          priority = excluded.priority,
          dimensions = excluded.dimensions,
          clauses = excluded.clauses,
          collections = excluded.collections,
          external_services = excluded.external_services,
          data_categories = excluded.data_categories,
          review_issue = excluded.review_issue,
          hardening_issue = excluded.hardening_issue,
          git_hash = excluded.git_hash,
          staleness = excluded.staleness,
          raw_contract = excluded.raw_contract,
          synced_at = excluded.synced_at
      `),
      deleteGovernanceFlowsNotIn: db.prepare(`
        DELETE FROM governance_flows WHERE project_id = ? AND id NOT IN (SELECT value FROM json_each(?))
      `),
      getGovernanceGateCriteria: db.prepare(`
        SELECT * FROM governance_gate_criteria WHERE project_id = ? ORDER BY criterion_number
      `),
      upsertGovernanceGateCriterion: db.prepare(`
        INSERT INTO governance_gate_criteria (id, project_id, criterion_number, label, status, evidence, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          status = excluded.status,
          evidence = excluded.evidence,
          updated_at = excluded.updated_at
      `),
      countGovernanceFlowsByMaturity: db.prepare(`
        SELECT maturity, COUNT(*) as cnt FROM governance_flows WHERE project_id = ? GROUP BY maturity
      `),
      countGovernanceFlowsByRiskTier: db.prepare(`
        SELECT risk_tier, COUNT(*) as cnt FROM governance_flows WHERE project_id = ? GROUP BY risk_tier
      `),
      countGovernanceTotalClauses: db.prepare(`
        SELECT SUM(json_array_length(clauses)) as total FROM governance_flows WHERE project_id = ?
      `),
      countGovernanceGatePassing: db.prepare(`
        SELECT COUNT(*) as cnt FROM governance_gate_criteria WHERE project_id = ? AND status = 'pass'
      `),
      countGovernanceGateTotal: db.prepare(`
        SELECT COUNT(*) as cnt FROM governance_gate_criteria WHERE project_id = ?
      `),
    };

    // Register finalizer
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        db.close();
      })
    );

    // DB row types — match SQLite column names (snake_case)
    // Union types match the CHECK constraints in the schema
    interface ProjectRow {
      id: string
      name: string
      description: string
      status: "active" | "archived" | "paused"
      color: string | null
      agent_timeout_minutes: number | null
      max_concurrent_agents: number | null
      created_at: number
      updated_at: number
    }

    interface ProjectDocumentRow {
      id: string
      project_id: string
      type: ProjectDocument["type"]
      title: string
      content: string
      created_at: number
      updated_at: number
    }

    interface KanbanCardRow {
      id: string
      project_id: string
      title: string
      description: string
      column: KanbanCard["column"]
      labels: string
      due_date: number | null
      linked_decision_ids: string
      linked_message_ids: string
      position: number
      priority: number | null
      context_snapshot: string | null
      last_session_id: string | null
      assigned_agent: AgentType | null
      agent_status: AgentStatus | null
      blocked_reason: string | null
      started_at: number | null
      completed_at: number | null
      verification_status: VerificationStatus | null
      campaign_id: string | null
      created_at: number
      updated_at: number
    }

    interface DecisionRow {
      id: string
      project_id: string
      title: string
      description: string
      alternatives: string
      reasoning: string
      tradeoffs: string
      created_at: number
      revised_at: number | null
    }

    interface MaxPositionRow {
      max_pos: number | null
    }

    interface MaxPriorityRow {
      max_pri: number | null
    }

    const mapCardRow = (r: KanbanCardRow): KanbanCard => ({
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
      verificationStatus: r.verification_status ?? null,
      campaignId: r.campaign_id ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

    return {
      saveMessage: (message) => messageRepo.saveMessage(message),

      getMessages: (projectId, limit, offset) => messageRepo.getMessages(projectId, limit, offset),

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
          const rows = stmts.getProjects.all() as ProjectRow[];
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            color: r.color || undefined,
            agentTimeoutMinutes: r.agent_timeout_minutes ?? undefined,
            maxConcurrentAgents: r.max_concurrent_agents ?? undefined,
          }));
        }),

      getProject: (id) =>
        Effect.sync(() => {
          const r = stmts.getProject.get(id) as ProjectRow | undefined;
          if (!r) return null;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            color: r.color || undefined,
            agentTimeoutMinutes: r.agent_timeout_minutes ?? undefined,
            maxConcurrentAgents: r.max_concurrent_agents ?? undefined,
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
            updates.agentTimeoutMinutes ?? null,
            updates.maxConcurrentAgents ?? null,
            Date.now(),
            id
          );
        }),

      getProjectDocuments: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getProjectDocuments.all(projectId) as ProjectDocumentRow[];
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
          const r = stmts.getProjectDocument.get(id) as ProjectDocumentRow | undefined;
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
          const rows = stmts.getCards.all(projectId) as KanbanCardRow[];
          return rows.map(mapCardRow);
        }),

      getCard: (id) =>
        Effect.sync(() => {
          const r = stmts.getCard.get(id) as KanbanCardRow | undefined;
          if (!r) return null;
          return mapCardRow(r);
        }),

      createCard: (projectId, title, description, column = "backlog") =>
        Effect.sync(() => {
          const id = randomUUID();
          const now = Date.now();
          const maxRow = stmts.getMaxCardPosition.get(projectId, column) as MaxPositionRow | undefined;
          const position = (maxRow?.max_pos ?? -1) + 1;
          stmts.createCard.run(id, projectId, title, description, column, position, now, now);
          return {
            id,
            projectId,
            title,
            description,
            column: column as KanbanCard["column"],
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
            verificationStatus: null,
            campaignId: null,
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
          const r = stmts.getNextCard.get(projectId) as KanbanCardRow | undefined;
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
          const maxPos = stmts.getMaxBacklogPosition.get(projectId) as MaxPositionRow | undefined;
          const maxPri = stmts.getMaxBacklogPriority.get(projectId) as MaxPriorityRow | undefined;
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

      logAudit: (entityType, entityId, action, details, actor) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = Date.now()
          stmts.insertAuditLog.run(id, entityType, entityId, action, actor ?? "system", JSON.stringify(details ?? {}), now)
        }),

      insertTokenUsage: (usage) =>
        Effect.sync(() => {
          const id = randomUUID()
          stmts.insertTokenUsage.run(
            id,
            usage.cardId ?? null,
            usage.projectId,
            usage.agent,
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadTokens,
            usage.cacheWriteTokens,
            usage.costUsd,
            usage.createdAt
          )
          return { id, ...usage }
        }),

      getDecisions: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getDecisions.all(projectId) as DecisionRow[];
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
          const r = stmts.getDecision.get(id) as DecisionRow | undefined;
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

      getUsageSummary: (projectId, days = 30) =>
        Effect.sync(() => {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

          // Query assistant messages with metadata in the time range
          const baseWhere = projectId
            ? `WHERE role = 'assistant' AND metadata IS NOT NULL AND timestamp >= ? AND project_id = ?`
            : `WHERE role = 'assistant' AND metadata IS NOT NULL AND timestamp >= ?`
          const params = projectId ? [cutoff, projectId] : [cutoff]

          const rows = db
            .prepare(`SELECT id, project_id, metadata, timestamp FROM messages ${baseWhere} ORDER BY timestamp DESC`)
            .all(...params) as Array<{ id: string; project_id: string | null; metadata: string; timestamp: number }>

          let totalInput = 0
          let totalOutput = 0
          let totalCost = 0
          const projectStats = new Map<string, { cost: number; count: number }>()
          const recentMessages: UsageSummary["recentMessages"] = []

          for (const row of rows) {
            let meta: Record<string, unknown>
            try {
              meta = JSON.parse(row.metadata)
            } catch {
              continue
            }

            const tokens = meta.tokens as { input: number; output: number } | undefined
            const cost = typeof meta.cost === "number" ? meta.cost : 0
            const input = tokens?.input ?? 0
            const output = tokens?.output ?? 0

            totalInput += input
            totalOutput += output
            totalCost += cost

            if (row.project_id) {
              const existing = projectStats.get(row.project_id)
              if (existing) {
                existing.cost += cost
                existing.count += 1
              } else {
                projectStats.set(row.project_id, { cost, count: 1 })
              }
            }

            if (recentMessages.length < 20) {
              recentMessages.push({
                messageId: row.id,
                projectId: row.project_id,
                cost,
                inputTokens: input,
                outputTokens: output,
                timestamp: row.timestamp,
              })
            }
          }

          // Look up project names for the byProject array
          const byProject: UsageSummary["byProject"] = []
          for (const [pid, stats] of projectStats) {
            const project = stmts.getProject.get(pid) as { name: string } | undefined
            byProject.push({
              projectId: pid,
              projectName: project?.name ?? "Unknown",
              totalCost: stats.cost,
              cardCount: stats.count,
            })
          }
          byProject.sort((a, b) => b.totalCost - a.totalCost)

          return {
            total: {
              inputTokens: totalInput,
              outputTokens: totalOutput,
              costUsd: totalCost,
            },
            byProject,
            recentMessages,
          }
        }),

      search: (query, projectId) =>
        Effect.sync(() => {
          const results: SearchResult[] = []
          const limit = 50
          const sanitized = query.replace(/"/g, '""')
          const ftsQuery = `"${sanitized}"`

          // Search kanban cards via FTS
          try {
            const cardRows = db.prepare(`
              SELECT c.id, c.project_id, snippet(kanban_cards_fts, 0, '<b>', '</b>', '...', 40) as title,
                     snippet(kanban_cards_fts, 1, '<b>', '</b>', '...', 40) as snippet
              FROM kanban_cards_fts
              JOIN kanban_cards c ON c.rowid = kanban_cards_fts.rowid
              WHERE kanban_cards_fts MATCH ?
              ${projectId ? "AND c.project_id = ?" : ""}
              ORDER BY rank LIMIT ?
            `).all(...(projectId ? [ftsQuery, projectId, limit] : [ftsQuery, limit])) as Array<Record<string, unknown>>
            for (const r of cardRows) {
              results.push({
                type: "card",
                id: r.id as string,
                title: r.title as string,
                snippet: r.snippet as string,
                projectId: (r.project_id as string) ?? null,
              })
            }
          } catch { /* FTS table may not have data yet */ }

          // Search project documents via FTS
          try {
            const docRows = db.prepare(`
              SELECT d.id, d.project_id, snippet(project_documents_fts, 0, '<b>', '</b>', '...', 40) as title,
                     snippet(project_documents_fts, 1, '<b>', '</b>', '...', 40) as snippet
              FROM project_documents_fts
              JOIN project_documents d ON d.rowid = project_documents_fts.rowid
              WHERE project_documents_fts MATCH ?
              ${projectId ? "AND d.project_id = ?" : ""}
              ORDER BY rank LIMIT ?
            `).all(...(projectId ? [ftsQuery, projectId, limit] : [ftsQuery, limit])) as Array<Record<string, unknown>>
            for (const r of docRows) {
              results.push({
                type: "document",
                id: r.id as string,
                title: r.title as string,
                snippet: r.snippet as string,
                projectId: (r.project_id as string) ?? null,
              })
            }
          } catch { /* FTS table may not have data yet */ }

          // Search decisions via FTS
          try {
            const decRows = db.prepare(`
              SELECT d.id, d.project_id, snippet(decisions_fts, 0, '<b>', '</b>', '...', 40) as title,
                     snippet(decisions_fts, 1, '<b>', '</b>', '...', 40) as snippet
              FROM decisions_fts
              JOIN decisions d ON d.rowid = decisions_fts.rowid
              WHERE decisions_fts MATCH ?
              ${projectId ? "AND d.project_id = ?" : ""}
              ORDER BY rank LIMIT ?
            `).all(...(projectId ? [ftsQuery, projectId, limit] : [ftsQuery, limit])) as Array<Record<string, unknown>>
            for (const r of decRows) {
              results.push({
                type: "decision",
                id: r.id as string,
                title: r.title as string,
                snippet: r.snippet as string,
                projectId: (r.project_id as string) ?? null,
              })
            }
          } catch { /* FTS table may not have data yet */ }

          return results.slice(0, limit)
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
            `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
          ).all(...params, limit, offset) as Array<Record<string, unknown>>

          const items: AuditEntry[] = rows.map((r) => ({
            id: r.id as string,
            entityType: r.entity_type as string,
            entityId: r.entity_id as string,
            action: r.action as string,
            actor: r.actor as string,
            details: typeof r.details === "string" ? JSON.parse(r.details) : {},
            timestamp: r.created_at as number,
          }))

          return { items, total }
        }),

      // Verification
      updateCardVerification: (id, status, output) =>
        Effect.sync(() => {
          stmts.updateCardVerification.run(status, output ?? null, Date.now(), id)
        }),

      getCardsByVerificationStatus: (status) =>
        Effect.sync(() => {
          const rows = stmts.getCardsByVerificationStatus.all(status) as KanbanCardRow[]
          return rows.map(mapCardRow)
        }),

      getCardsByCampaign: (campaignId) =>
        Effect.sync(() => {
          const rows = stmts.getCardsByCampaign.all(campaignId) as KanbanCardRow[]
          return rows.map(mapCardRow)
        }),

      // Campaigns
      createCampaign: (projectId, name, description) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = Date.now()
          stmts.createCampaign.run(id, projectId, name, description, null, now, now)
          return {
            id,
            projectId,
            name,
            description,
            status: "active" as const,
            baselineMetrics: null,
            createdAt: now,
            updatedAt: now,
          }
        }),

      getCampaign: (id) =>
        Effect.sync(() => {
          const r = stmts.getCampaign.get(id) as Record<string, unknown> | undefined
          if (!r) return null
          return {
            id: r.id as string,
            projectId: r.project_id as string,
            name: r.name as string,
            description: r.description as string,
            status: r.status as Campaign["status"],
            baselineMetrics: r.baseline_metrics ? JSON.parse(r.baseline_metrics as string) as CodebaseMetrics : null,
            createdAt: r.created_at as number,
            updatedAt: r.updated_at as number,
          }
        }),

      getCampaigns: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getCampaigns.all(projectId) as Array<Record<string, unknown>>
          return rows.map((r) => ({
            id: r.id as string,
            projectId: r.project_id as string,
            name: r.name as string,
            description: r.description as string,
            status: r.status as Campaign["status"],
            baselineMetrics: r.baseline_metrics ? JSON.parse(r.baseline_metrics as string) as CodebaseMetrics : null,
            createdAt: r.created_at as number,
            updatedAt: r.updated_at as number,
          }))
        }),

      updateCampaign: (id, updates) =>
        Effect.sync(() => {
          stmts.updateCampaign.run(
            updates.name ?? null,
            updates.description ?? null,
            updates.status ?? null,
            updates.baselineMetrics ? JSON.stringify(updates.baselineMetrics) : null,
            Date.now(),
            id,
          )
        }),

      // Campaign reports
      createCampaignReport: (report) =>
        Effect.sync(() => {
          const id = randomUUID()
          stmts.createCampaignReport.run(
            id,
            report.campaignId,
            JSON.stringify(report.baselineMetrics),
            JSON.stringify(report.currentMetrics),
            report.cardsCompleted,
            report.cardsRemaining,
            report.cardsBlocked,
            report.createdAt,
          )
          return { id, ...report }
        }),

      getCampaignReports: (campaignId, limit = 20) =>
        Effect.sync(() => {
          const rows = stmts.getCampaignReports.all(campaignId, limit) as Array<Record<string, unknown>>
          return rows.map((r) => ({
            id: r.id as string,
            campaignId: r.campaign_id as string,
            baselineMetrics: JSON.parse(r.baseline_metrics as string) as CodebaseMetrics,
            currentMetrics: JSON.parse(r.current_metrics as string) as CodebaseMetrics,
            cardsCompleted: r.cards_completed as number,
            cardsRemaining: r.cards_remaining as number,
            cardsBlocked: r.cards_blocked as number,
            delta: {
              lintWarnings: (JSON.parse(r.current_metrics as string) as CodebaseMetrics).lintWarnings - (JSON.parse(r.baseline_metrics as string) as CodebaseMetrics).lintWarnings,
              lintErrors: (JSON.parse(r.current_metrics as string) as CodebaseMetrics).lintErrors - (JSON.parse(r.baseline_metrics as string) as CodebaseMetrics).lintErrors,
              anyCount: (JSON.parse(r.current_metrics as string) as CodebaseMetrics).anyCount - (JSON.parse(r.baseline_metrics as string) as CodebaseMetrics).anyCount,
              testFileCount: (JSON.parse(r.current_metrics as string) as CodebaseMetrics).testFileCount - (JSON.parse(r.baseline_metrics as string) as CodebaseMetrics).testFileCount,
            },
            createdAt: r.created_at as number,
          }))
        }),

      // Governance
      getGovernanceFlows: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getGovernanceFlows.all(projectId) as Array<Record<string, unknown>>
          return rows.map((r): GovernanceFlow => ({
            id: r.id as string,
            projectId: r.project_id as string,
            flowName: r.flow_name as string,
            sourceFile: r.source_file as string,
            riskTier: r.risk_tier as RiskTier,
            maturity: r.maturity as MaturityLevel,
            priority: r.priority as FlowPriority,
            dimensions: JSON.parse(r.dimensions as string),
            clauses: JSON.parse(r.clauses as string),
            collections: JSON.parse(r.collections as string),
            externalServices: JSON.parse(r.external_services as string),
            dataCategories: JSON.parse(r.data_categories as string),
            reviewIssue: r.review_issue as string | null,
            hardeningIssue: r.hardening_issue as string | null,
            gitHash: r.git_hash as string,
            staleness: r.staleness as StalenessStatus,
            syncedAt: r.synced_at as number,
          }))
        }),

      getGovernanceFlow: (flowId, projectId) =>
        Effect.sync(() => {
          const r = stmts.getGovernanceFlow.get(flowId, projectId) as Record<string, unknown> | undefined
          if (!r) return null
          return {
            id: r.id as string,
            projectId: r.project_id as string,
            flowName: r.flow_name as string,
            sourceFile: r.source_file as string,
            riskTier: r.risk_tier as RiskTier,
            maturity: r.maturity as MaturityLevel,
            priority: r.priority as FlowPriority,
            dimensions: JSON.parse(r.dimensions as string),
            clauses: JSON.parse(r.clauses as string) as GovernanceClause[],
            collections: JSON.parse(r.collections as string),
            externalServices: JSON.parse(r.external_services as string),
            dataCategories: JSON.parse(r.data_categories as string),
            reviewIssue: r.review_issue as string | null,
            hardeningIssue: r.hardening_issue as string | null,
            gitHash: r.git_hash as string,
            staleness: r.staleness as StalenessStatus,
            syncedAt: r.synced_at as number,
          } satisfies GovernanceFlow
        }),

      syncGovernanceCorpus: (projectId, corpus) =>
        Effect.sync(() => {
          const now = Date.now()
          const contractIds: string[] = []

          const syncTransaction = db.transaction(() => {
            for (const c of corpus.contracts) {
              const id = c.contractId as string
              contractIds.push(id)
              stmts.upsertGovernanceFlow.run(
                id,
                projectId,
                (c.flowName as string) ?? "",
                (c.sourceFile as string) ?? "",
                (c.riskTier as string) ?? "T5",
                (c.maturity as string) ?? "L0",
                (c.priority as string) ?? "P2",
                JSON.stringify(c.dimensions ?? []),
                JSON.stringify(c.clauses ?? []),
                JSON.stringify(c.collections ?? []),
                JSON.stringify(c.externalServices ?? []),
                JSON.stringify(c.dataCategories ?? []),
                (c.reviewIssue as string) ?? null,
                (c.hardeningIssue as string) ?? null,
                (c.gitHash as string) ?? "",
                "unknown",
                JSON.stringify(c),
                now,
              )
            }
            // Remove flows not in the current corpus
            const result = stmts.deleteGovernanceFlowsNotIn.run(projectId, JSON.stringify(contractIds))
            return { synced: contractIds.length, removed: result.changes }
          })

          return syncTransaction()
        }),

      getGovernanceGateCriteria: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getGovernanceGateCriteria.all(projectId) as Array<Record<string, unknown>>
          return rows.map((r): GateCriterion => ({
            id: r.id as string,
            projectId: r.project_id as string,
            criterionNumber: r.criterion_number as number,
            label: r.label as string,
            status: r.status as GateStatus,
            evidence: r.evidence as string | null,
            updatedAt: r.updated_at as number,
          }))
        }),

      upsertGovernanceGateCriterion: (criterion) =>
        Effect.sync(() => {
          stmts.upsertGovernanceGateCriterion.run(
            criterion.id,
            criterion.projectId,
            criterion.criterionNumber,
            criterion.label,
            criterion.status,
            criterion.evidence ?? null,
            criterion.updatedAt,
          )
        }),

      getGovernanceSummary: (projectId) =>
        Effect.sync(() => {
          const maturityRows = stmts.countGovernanceFlowsByMaturity.all(projectId) as Array<{ maturity: string; cnt: number }>
          const riskRows = stmts.countGovernanceFlowsByRiskTier.all(projectId) as Array<{ risk_tier: string; cnt: number }>
          const clauseRow = stmts.countGovernanceTotalClauses.get(projectId) as { total: number | null }
          const passingRow = stmts.countGovernanceGatePassing.get(projectId) as { cnt: number }
          const totalGateRow = stmts.countGovernanceGateTotal.get(projectId) as { cnt: number }

          const maturityCounts: Record<MaturityLevel, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 }
          for (const r of maturityRows) {
            maturityCounts[r.maturity as MaturityLevel] = r.cnt
          }

          const riskTierCounts: Record<RiskTier, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 }
          for (const r of riskRows) {
            riskTierCounts[r.risk_tier as RiskTier] = r.cnt
          }

          const totalFlows = maturityRows.reduce((sum, r) => sum + r.cnt, 0)
          const passing = passingRow.cnt
          const totalGate = totalGateRow.cnt

          return {
            maturityCounts,
            totalFlows,
            totalClauses: clauseRow.total ?? 0,
            riskTierCounts,
            gate: {
              passing,
              total: totalGate,
              status: (totalGate > 0 && passing === totalGate ? "GO" : "NO-GO") as "GO" | "NO-GO",
            },
          } satisfies GovernanceSummary
        }),

      backupDatabase: (destinationPath) =>
        Effect.tryPromise({
          try: () => db.backup(destinationPath),
          catch: (err) => new Error(`Database backup failed: ${err}`),
        }).pipe(Effect.asVoid),
    };
  })
);
