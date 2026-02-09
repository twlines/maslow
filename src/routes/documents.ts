/**
 * Document route handlers
 *
 * Handles CRUD operations for project documents.
 */

import { Effect } from "effect"
import type { ServerResponse } from "http"
import type { AppPersistenceService } from "../services/AppPersistence.js"
import { sendJson } from "./shared.js"

export interface DocumentDeps {
  db: AppPersistenceService
}

export const handleGetDocuments = (
  deps: DocumentDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.db.getProjectDocuments(projectId)).then(
    (docs) => sendJson(res, 200, { ok: true, data: docs }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleCreateDocument = (
  deps: DocumentDeps,
  res: ServerResponse,
  projectId: string,
  body: { type?: string; title?: string; content?: string }
): void => {
  if (!body.type || !body.title) {
    sendJson(res, 400, { ok: false, error: "type and title are required" })
    return
  }
  Effect.runPromise(
    deps.db.createProjectDocument(
      projectId,
      body.type as Parameters<AppPersistenceService["createProjectDocument"]>[1],
      body.title,
      body.content || ""
    )
  ).then(
    (doc) => sendJson(res, 201, { ok: true, data: doc }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleGetDocument = (
  deps: DocumentDeps,
  res: ServerResponse,
  docId: string
): void => {
  Effect.runPromise(deps.db.getProjectDocument(docId)).then(
    (doc) => {
      if (!doc) {
        sendJson(res, 404, { ok: false, error: "Document not found" })
        return
      }
      sendJson(res, 200, { ok: true, data: doc })
    },
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleUpdateDocument = (
  deps: DocumentDeps,
  res: ServerResponse,
  docId: string,
  body: Record<string, unknown>
): void => {
  Effect.runPromise(
    deps.db.updateProjectDocument(docId, body as Parameters<AppPersistenceService["updateProjectDocument"]>[1])
  ).then(
    () => sendJson(res, 200, { ok: true, data: { id: docId, ...body } }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}
