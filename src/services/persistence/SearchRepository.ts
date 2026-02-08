/**
 * SearchRepository — full-text search across kanban_cards, project_documents, decisions.
 *
 * Uses FTS5 virtual tables that are kept in sync via triggers defined in AppPersistence schema.
 * Depends only on DatabaseManager.
 */

import { Context, Effect, Layer } from "effect"
import { DatabaseManager } from "./DatabaseManager.js"

export interface SearchResult {
  type: "card" | "document" | "decision"
  id: string
  projectId: string
  title: string
  snippet: string
  rank: number
}

export interface SearchRepositoryService {
  search(query: string, projectId?: string): Effect.Effect<SearchResult[]>
}

export class SearchRepository extends Context.Tag("SearchRepository")<
  SearchRepository,
  SearchRepositoryService
>() {}

export const SearchRepositoryLive = Layer.effect(
  SearchRepository,
  Effect.gen(function* () {
    const { db } = yield* DatabaseManager

    return {
      search: (query, projectId) =>
        Effect.sync(() => {
          const ftsQuery = query.trim()
          if (!ftsQuery) return []

          const results: SearchResult[] = []

          // Search kanban cards
          const cardSql = projectId
            ? `SELECT k.id, k.project_id, k.title, snippet(kanban_cards_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM kanban_cards_fts
               JOIN kanban_cards k ON k.rowid = kanban_cards_fts.rowid
               WHERE kanban_cards_fts MATCH ?
               AND k.project_id = ?
               ORDER BY rank
               LIMIT 20`
            : `SELECT k.id, k.project_id, k.title, snippet(kanban_cards_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM kanban_cards_fts
               JOIN kanban_cards k ON k.rowid = kanban_cards_fts.rowid
               WHERE kanban_cards_fts MATCH ?
               ORDER BY rank
               LIMIT 20`

          const cardParams = projectId ? [ftsQuery, projectId] : [ftsQuery]
          try {
            const cardRows = db.prepare(cardSql).all(...cardParams) as Array<Record<string, unknown>>
            for (const r of cardRows) {
              results.push({
                type: "card",
                id: r.id as string,
                projectId: r.project_id as string,
                title: r.title as string,
                snippet: (r.snippet as string) || "",
                rank: r.rank as number,
              })
            }
          } catch {
            // FTS match can fail on invalid query syntax — skip silently
          }

          // Search project documents
          const docSql = projectId
            ? `SELECT d.id, d.project_id, d.title, snippet(project_documents_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM project_documents_fts
               JOIN project_documents d ON d.rowid = project_documents_fts.rowid
               WHERE project_documents_fts MATCH ?
               AND d.project_id = ?
               ORDER BY rank
               LIMIT 20`
            : `SELECT d.id, d.project_id, d.title, snippet(project_documents_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM project_documents_fts
               JOIN project_documents d ON d.rowid = project_documents_fts.rowid
               WHERE project_documents_fts MATCH ?
               ORDER BY rank
               LIMIT 20`

          const docParams = projectId ? [ftsQuery, projectId] : [ftsQuery]
          try {
            const docRows = db.prepare(docSql).all(...docParams) as Array<Record<string, unknown>>
            for (const r of docRows) {
              results.push({
                type: "document",
                id: r.id as string,
                projectId: r.project_id as string,
                title: r.title as string,
                snippet: (r.snippet as string) || "",
                rank: r.rank as number,
              })
            }
          } catch {
            // FTS match can fail on invalid query syntax — skip silently
          }

          // Search decisions
          const decSql = projectId
            ? `SELECT d.id, d.project_id, d.title, snippet(decisions_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM decisions_fts
               JOIN decisions d ON d.rowid = decisions_fts.rowid
               WHERE decisions_fts MATCH ?
               AND d.project_id = ?
               ORDER BY rank
               LIMIT 20`
            : `SELECT d.id, d.project_id, d.title, snippet(decisions_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
               FROM decisions_fts
               JOIN decisions d ON d.rowid = decisions_fts.rowid
               WHERE decisions_fts MATCH ?
               ORDER BY rank
               LIMIT 20`

          const decParams = projectId ? [ftsQuery, projectId] : [ftsQuery]
          try {
            const decRows = db.prepare(decSql).all(...decParams) as Array<Record<string, unknown>>
            for (const r of decRows) {
              results.push({
                type: "decision",
                id: r.id as string,
                projectId: r.project_id as string,
                title: r.title as string,
                snippet: (r.snippet as string) || "",
                rank: r.rank as number,
              })
            }
          } catch {
            // FTS match can fail on invalid query syntax — skip silently
          }

          // Sort all results by rank (lower is better in FTS5)
          results.sort((a, b) => a.rank - b.rank)

          return results
        }),
    }
  })
)
