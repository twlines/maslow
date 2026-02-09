/**
 * Decision Repository Service
 *
 * Extracted from AppPersistence — manages CRUD for architecture decisions
 * with full-text search via FTS5.
 */

import { Context, Effect, Layer } from "effect"
import Database from "better-sqlite3"
import { randomUUID } from "crypto"
import { ConfigService } from "./Config.js"
import * as fs from "fs"
import * as path from "path"

export interface AppDecision {
  id: string
  projectId: string
  title: string
  description: string
  alternatives: string[]
  reasoning: string
  tradeoffs: string
  createdAt: number
  revisedAt?: number
}

export interface DecisionRepositoryService {
  getDecisions(projectId: string): Effect.Effect<AppDecision[]>
  getDecision(id: string): Effect.Effect<AppDecision | null>
  createDecision(
    projectId: string,
    title: string,
    description: string,
    alternatives: string[],
    reasoning: string,
    tradeoffs: string
  ): Effect.Effect<AppDecision>
  updateDecision(
    id: string,
    updates: Partial<{
      title: string
      description: string
      alternatives: string[]
      reasoning: string
      tradeoffs: string
    }>
  ): Effect.Effect<void>
}

export class DecisionRepository extends Context.Tag("DecisionRepository")<
  DecisionRepository,
  DecisionRepositoryService
>() {}

export const DecisionRepositoryLive = Layer.scoped(
  DecisionRepository,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const dbDir = path.dirname(config.database.path)
    const dbPath = path.join(dbDir, "app.db")

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    const db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")

    // Schema
    db.exec(`
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
    `)

    // FTS5
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
        title, description, reasoning,
        content=decisions, content_rowid=rowid
      );
    `)

    // FTS triggers
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
    `)

    // Prepared statements
    const stmts = {
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
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        db.close()
      })
    )

    const mapDecisionRow = (r: Record<string, unknown>): AppDecision => ({
      id: r.id as string,
      projectId: r.project_id as string,
      title: r.title as string,
      description: r.description as string,
      alternatives: JSON.parse(r.alternatives as string),
      reasoning: r.reasoning as string,
      tradeoffs: r.tradeoffs as string,
      createdAt: r.created_at as number,
      revisedAt: (r.revised_at as number | null) ?? undefined,
    })

    return {
      getDecisions: (projectId) =>
        Effect.sync(() => {
          const rows = stmts.getDecisions.all(projectId) as Record<string, unknown>[]
          return rows.map(mapDecisionRow)
        }),

      getDecision: (id) =>
        Effect.sync(() => {
          const r = stmts.getDecision.get(id) as Record<string, unknown> | undefined
          if (!r) return null
          return mapDecisionRow(r)
        }),

      createDecision: (projectId, title, description, alternatives, reasoning, tradeoffs) =>
        Effect.sync(() => {
          const id = randomUUID()
          const now = Date.now()
          stmts.createDecision.run(id, projectId, title, description, JSON.stringify(alternatives), reasoning, tradeoffs, now)
          return {
            id,
            projectId,
            title,
            description,
            alternatives,
            reasoning,
            tradeoffs,
            createdAt: now,
          }
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
          )
        }),
    }
  })
)
