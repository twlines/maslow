/**
 * Document Repository
 *
 * Extracted from AppPersistence — handles CRUD for the project_documents table.
 */

import { Effect } from "effect"
import { randomUUID } from "crypto"
import type Database from "better-sqlite3"

export interface AppProjectDocument {
  id: string
  projectId: string
  type: "brief" | "instructions" | "reference" | "decisions" | "assumptions" | "state"
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface DocumentRepositoryService {
  getProjectDocuments(projectId: string): Effect.Effect<AppProjectDocument[]>
  getProjectDocument(id: string): Effect.Effect<AppProjectDocument | null>
  createProjectDocument(projectId: string, type: AppProjectDocument["type"], title: string, content: string): Effect.Effect<AppProjectDocument>
  updateProjectDocument(id: string, updates: Partial<Pick<AppProjectDocument, "title" | "content">>): Effect.Effect<void>
}

function mapRow(r: Record<string, unknown>): AppProjectDocument {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    type: r.type as AppProjectDocument["type"],
    title: r.title as string,
    content: r.content as string,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }
}

export function createDocumentRepository(db: Database.Database): DocumentRepositoryService {
  const stmts = {
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
  }

  return {
    getProjectDocuments: (projectId) =>
      Effect.sync(() => {
        const rows = stmts.getProjectDocuments.all(projectId) as Record<string, unknown>[]
        return rows.map(mapRow)
      }),

    getProjectDocument: (id) =>
      Effect.sync(() => {
        const r = stmts.getProjectDocument.get(id) as Record<string, unknown> | undefined
        if (!r) return null
        return mapRow(r)
      }),

    createProjectDocument: (projectId, type, title, content) =>
      Effect.sync(() => {
        const id = randomUUID()
        const now = Date.now()
        stmts.createProjectDocument.run(id, projectId, type, title, content, now, now)
        return {
          id,
          projectId,
          type,
          title,
          content,
          createdAt: now,
          updatedAt: now,
        }
      }),

    updateProjectDocument: (id, updates) =>
      Effect.sync(() => {
        stmts.updateProjectDocument.run(
          updates.title ?? null,
          updates.content ?? null,
          Date.now(),
          id
        )
      }),
  }
}
