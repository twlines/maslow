/**
 * Card route handlers
 *
 * Handles kanban card CRUD and work queue operations.
 */

import { Effect } from "effect"
import type { ServerResponse } from "http"
import type { AppPersistenceService } from "../services/AppPersistence.js"
import type { KanbanService } from "../services/Kanban.js"
import { sendJson } from "./shared.js"

export interface CardDeps {
  db: AppPersistenceService
  kanban: KanbanService
}

export const handleGetCards = (
  deps: CardDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.kanban.getBoard(projectId)).then(
    (board) => sendJson(res, 200, { ok: true, data: board }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleCreateCard = (
  deps: CardDeps,
  res: ServerResponse,
  projectId: string,
  body: { title?: string; description?: string; column?: string }
): void => {
  if (!body.title) {
    sendJson(res, 400, { ok: false, error: "title is required" })
    return
  }
  Effect.runPromise(deps.kanban.createCard(projectId, body.title, body.description, body.column)).then(
    (card) => sendJson(res, 201, { ok: true, data: card }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleUpdateCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string,
  body: Record<string, unknown>
): void => {
  const update = async () => {
    if (body.if_updated_at !== undefined) {
      const current = await Effect.runPromise(deps.db.getCard(cardId))
      if (!current) {
        sendJson(res, 404, { ok: false, error: "Card not found" })
        return
      }
      if (current.updatedAt !== body.if_updated_at) {
        sendJson(res, 409, {
          ok: false,
          error: "Card was modified by another client",
          currentUpdatedAt: current.updatedAt,
        })
        return
      }
    }
    if (body.column !== undefined) {
      await Effect.runPromise(deps.kanban.moveCard(cardId, body.column as "backlog" | "in_progress" | "done"))
    }
    await Effect.runPromise(deps.kanban.updateCard(cardId, body as Parameters<KanbanService["updateCard"]>[1]))
    sendJson(res, 200, { ok: true, data: { id: cardId, ...body } })
  }
  update().catch(() => sendJson(res, 500, { ok: false, error: "Internal server error" }))
}

export const handleDeleteCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string
): void => {
  Effect.runPromise(deps.kanban.deleteCard(cardId)).then(
    () => sendJson(res, 200, { ok: true, data: { deleted: true } }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleGetNextCard = (
  deps: CardDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.kanban.getNext(projectId)).then(
    (card) => sendJson(res, 200, { ok: true, data: card }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleSaveCardContext = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string,
  body: { snapshot?: string; sessionId?: string }
): void => {
  if (!body.snapshot) {
    sendJson(res, 400, { ok: false, error: "snapshot is required" })
    return
  }
  Effect.runPromise(deps.kanban.saveContext(cardId, body.snapshot, body.sessionId)).then(
    () => sendJson(res, 200, { ok: true }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleSkipCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string
): void => {
  Effect.runPromise(deps.kanban.skipToBack(cardId)).then(
    () => sendJson(res, 200, { ok: true }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleAssignCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string,
  body: { agent?: string }
): void => {
  if (!body.agent) {
    sendJson(res, 400, { ok: false, error: "agent is required" })
    return
  }
  Effect.runPromise(deps.kanban.assignAgent(cardId, body.agent as "claude" | "codex" | "gemini")).then(
    () => sendJson(res, 200, { ok: true }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleStartCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string,
  body: { agent?: string }
): void => {
  Effect.runPromise(deps.kanban.startWork(cardId, body.agent as "claude" | "codex" | "gemini" | undefined)).then(
    () => sendJson(res, 200, { ok: true }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleCompleteCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string
): void => {
  Effect.runPromise(deps.kanban.completeWork(cardId)).then(
    () => sendJson(res, 200, { ok: true }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleResumeCard = (
  deps: CardDeps,
  res: ServerResponse,
  cardId: string
): void => {
  Effect.runPromise(deps.kanban.resume(cardId)).then(
    (result) => sendJson(res, 200, { ok: true, data: result }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}
