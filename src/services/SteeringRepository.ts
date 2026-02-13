/**
 * Steering Repository
 *
 * Extracted from AppPersistence — owns all data access for:
 * - Steering corrections (CRUD + filtering)
 * - Audit log (insert + query)
 * - Token usage (insert)
 * - Usage summary (aggregate query over messages)
 * - Full-text search (FTS5 across cards, documents, decisions)
 */

import { Effect } from "effect"
import { randomUUID } from "crypto"
import type Database from "better-sqlite3"
import type {
  CorrectionDomain,
  CorrectionSource,
  SteeringCorrection,
  TokenUsage,
  UsageSummary,
} from "./AppPersistence.js"

export interface AuditLogEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  actor: string
  details: Record<string, unknown>
  createdAt: number
}

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  limit?: number
  offset?: number
}

export interface SearchResult {
  type: "card" | "document" | "decision"
  id: string
  title: string
  snippet: string
  projectId: string | null
}

export interface SteeringRepositoryMethods {
  // Steering corrections
  addCorrection(correction: string, domain: CorrectionDomain, source: CorrectionSource, context?: string, projectId?: string): Effect.Effect<SteeringCorrection>
  getCorrections(opts?: { domain?: CorrectionDomain; projectId?: string | null; activeOnly?: boolean }): Effect.Effect<SteeringCorrection[]>
  deactivateCorrection(id: string): Effect.Effect<void>
  reactivateCorrection(id: string): Effect.Effect<void>
  deleteCorrection(id: string): Effect.Effect<void>

  // Audit log
  logAudit(entityType: string, entityId: string, action: string, details?: Record<string, unknown>, actor?: string): Effect.Effect<void>
  getAuditLog(filters: AuditLogFilters): Effect.Effect<AuditLogEntry[]>

  // Token usage
  insertTokenUsage(usage: Omit<TokenUsage, "id">): Effect.Effect<TokenUsage>

  // Usage summary
  getUsageSummary(projectId?: string, days?: number): Effect.Effect<UsageSummary>

  // Full-text search
  search(query: string, projectId?: string): Effect.Effect<SearchResult[]>
}

const mapCorrectionRow = (r: Record<string, unknown>): SteeringCorrection => ({
  id: r.id as string,
  correction: r.correction as string,
  domain: r.domain as CorrectionDomain,
  source: r.source as CorrectionSource,
  context: r.context as string | null,
  projectId: r.project_id as string | null,
  active: (r.active as number) === 1,
  createdAt: r.created_at as number,
})

const mapAuditRow = (r: Record<string, unknown>): AuditLogEntry => ({
  id: r.id as string,
  entityType: r.entity_type as string,
  entityId: r.entity_id as string,
  action: r.action as string,
  actor: r.actor as string,
  details: JSON.parse((r.details as string) || "{}"),
  createdAt: r.created_at as number,
})

export function createSteeringRepository(db: Database.Database): SteeringRepositoryMethods {
  const stmts = {
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
    getAuditLog: db.prepare(`
      SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    getAuditLogByType: db.prepare(`
      SELECT * FROM audit_log WHERE entity_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    getAuditLogByEntity: db.prepare(`
      SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),

    // Token usage
    insertTokenUsage: db.prepare(`
      INSERT INTO token_usage (id, card_id, project_id, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    // Search
    searchCards: db.prepare(`
      SELECT k.id, k.title, k.description, k.project_id
      FROM kanban_cards_fts f
      JOIN kanban_cards k ON k.rowid = f.rowid
      WHERE kanban_cards_fts MATCH ?
      LIMIT 20
    `),
    searchCardsByProject: db.prepare(`
      SELECT k.id, k.title, k.description, k.project_id
      FROM kanban_cards_fts f
      JOIN kanban_cards k ON k.rowid = f.rowid
      WHERE kanban_cards_fts MATCH ? AND k.project_id = ?
      LIMIT 20
    `),
    searchDocuments: db.prepare(`
      SELECT d.id, d.title, d.content, d.project_id
      FROM project_documents_fts f
      JOIN project_documents d ON d.rowid = f.rowid
      WHERE project_documents_fts MATCH ?
      LIMIT 20
    `),
    searchDocumentsByProject: db.prepare(`
      SELECT d.id, d.title, d.content, d.project_id
      FROM project_documents_fts f
      JOIN project_documents d ON d.rowid = f.rowid
      WHERE project_documents_fts MATCH ? AND d.project_id = ?
      LIMIT 20
    `),
    searchDecisions: db.prepare(`
      SELECT dc.id, dc.title, dc.description, dc.project_id
      FROM decisions_fts f
      JOIN decisions dc ON dc.rowid = f.rowid
      WHERE decisions_fts MATCH ?
      LIMIT 20
    `),
    searchDecisionsByProject: db.prepare(`
      SELECT dc.id, dc.title, dc.description, dc.project_id
      FROM decisions_fts f
      JOIN decisions dc ON dc.rowid = f.rowid
      WHERE decisions_fts MATCH ? AND dc.project_id = ?
      LIMIT 20
    `),

    // Usage summary helper
    getProject: db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `),
  }

  return {
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

        return rows.map(mapCorrectionRow)
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

    getAuditLog: (filters) =>
      Effect.sync(() => {
        const limit = filters.limit ?? 50
        const offset = filters.offset ?? 0

        let rows: Record<string, unknown>[]
        if (filters.entityType && filters.entityId) {
          rows = stmts.getAuditLogByEntity.all(filters.entityType, filters.entityId, limit, offset) as Record<string, unknown>[]
        } else if (filters.entityType) {
          rows = stmts.getAuditLogByType.all(filters.entityType, limit, offset) as Record<string, unknown>[]
        } else {
          rows = stmts.getAuditLog.all(limit, offset) as Record<string, unknown>[]
        }

        return rows.map(mapAuditRow)
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

    getUsageSummary: (projectId, days = 30) =>
      Effect.sync(() => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

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
        const ftsQuery = query.replace(/[^\w\s]/g, "").trim()
        if (!ftsQuery) return results

        try {
          // Search kanban cards
          const cardRows = projectId
            ? stmts.searchCardsByProject.all(ftsQuery, projectId) as Array<Record<string, unknown>>
            : stmts.searchCards.all(ftsQuery) as Array<Record<string, unknown>>
          for (const r of cardRows) {
            const desc = r.description as string
            results.push({
              type: "card",
              id: r.id as string,
              title: r.title as string,
              snippet: desc.length > 200 ? desc.slice(0, 197) + "..." : desc,
              projectId: r.project_id as string | null,
            })
          }

          // Search documents
          const docRows = projectId
            ? stmts.searchDocumentsByProject.all(ftsQuery, projectId) as Array<Record<string, unknown>>
            : stmts.searchDocuments.all(ftsQuery) as Array<Record<string, unknown>>
          for (const r of docRows) {
            const content = r.content as string
            results.push({
              type: "document",
              id: r.id as string,
              title: r.title as string,
              snippet: content.length > 200 ? content.slice(0, 197) + "..." : content,
              projectId: r.project_id as string | null,
            })
          }

          // Search decisions
          const decisionRows = projectId
            ? stmts.searchDecisionsByProject.all(ftsQuery, projectId) as Array<Record<string, unknown>>
            : stmts.searchDecisions.all(ftsQuery) as Array<Record<string, unknown>>
          for (const r of decisionRows) {
            const desc = r.description as string
            results.push({
              type: "decision",
              id: r.id as string,
              title: r.title as string,
              snippet: desc.length > 200 ? desc.slice(0, 197) + "..." : desc,
              projectId: r.project_id as string | null,
            })
          }
        } catch {
          // FTS query syntax error — return empty results
        }

        return results
      }),
  }
}
