/**
 * Project route handlers
 *
 * Handles CRUD operations for projects.
 */

import { Effect } from "effect"
import type { ServerResponse } from "http"
import type { AppPersistenceService } from "../services/AppPersistence.js"
import { sendJson } from "./shared.js"

export interface ProjectDeps {
  db: AppPersistenceService
}

export const handleGetProjects = (
  deps: ProjectDeps,
  res: ServerResponse
): void => {
  Effect.runPromise(deps.db.getProjects()).then(
    (projects) => sendJson(res, 200, { ok: true, data: projects }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleCreateProject = (
  deps: ProjectDeps,
  res: ServerResponse,
  body: { name?: string; description?: string }
): void => {
  if (!body.name) {
    sendJson(res, 400, { ok: false, error: "name is required" })
    return
  }
  Effect.runPromise(deps.db.createProject(body.name, body.description || "")).then(
    (project) => sendJson(res, 201, { ok: true, data: project }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleGetProject = (
  deps: ProjectDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.db.getProject(projectId)).then(
    (project) => {
      if (!project) {
        sendJson(res, 404, { ok: false, error: "Project not found" })
        return
      }
      sendJson(res, 200, { ok: true, data: project })
    },
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleUpdateProject = (
  deps: ProjectDeps,
  res: ServerResponse,
  projectId: string,
  body: Record<string, unknown>
): void => {
  Effect.runPromise(deps.db.updateProject(projectId, body as Parameters<AppPersistenceService["updateProject"]>[1])).then(
    () => sendJson(res, 200, { ok: true, data: { id: projectId, ...body } }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}
