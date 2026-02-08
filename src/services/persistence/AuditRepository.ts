/**
 * AuditRepository — audit log persistence extracted from AppPersistence.
 *
 * Provides logAudit (insert) and getAuditLog (query with filters).
 * Depends only on DatabaseManager.
 */

import { Context, Effect, Layer } from "effect"
import { randomUUID } from "crypto"
import { DatabaseManager } from "./DatabaseManager.js"

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  action?: string
  actor?: string
  limit?: number
  offset?: number
}

export interface AuditLogEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  actor: string
  details: Record<string, unknown>
  createdAt: number
}

export interface AuditLogResult {
  entries: AuditLogEntry[]
  total: number
}

export interface AuditRepositoryService {
  logAudit(
    entityType: string,
    entityId: string,
    action: string,
    details?: Record<string, unknown>,
    actor?: string
  ): Effect.Effect<void>

  getAuditLog(filters: AuditLogFilters): Effect.Effect<AuditLogResult>
}

export class AuditRepository extends Context.Tag("AuditRepository")<
  AuditRepository,
  AuditRepositoryService
>() {}

export const AuditRepositoryLive = Layer.effect(
  AuditRepository,
  Effect.gen(function* () {
    const { db } = yield* DatabaseManager

    const stmts = {
      insert: db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, actor, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      countAll: db.prepare(`
        SELECT COUNT(*) as total FROM audit_log
      `),
    }

    return {
      logAudit: (entityType, entityId, action, details, actor) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = Date.now()
          stmts.insert.run(
            id,
            entityType,
            entityId,
            action,
            actor ?? "system",
            JSON.stringify(details ?? {}),
            now
          )
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
          if (filters.action) {
            conditions.push("action = ?")
            params.push(filters.action)
          }
          if (filters.actor) {
            conditions.push("actor = ?")
            params.push(filters.actor)
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
          const limit = filters.limit ?? 50
          const offset = filters.offset ?? 0

          const countRow = db
            .prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`)
            .get(...params) as { total: number }

          const rows = db
            .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset) as Array<Record<string, unknown>>

          const entries: AuditLogEntry[] = rows.map((r) => ({
            id: r.id as string,
            entityType: r.entity_type as string,
            entityId: r.entity_id as string,
            action: r.action as string,
            actor: r.actor as string,
            details: JSON.parse((r.details as string) || "{}"),
            createdAt: r.created_at as number,
          }))

          return { entries, total: countRow.total }
        }),
    }
  })
)
