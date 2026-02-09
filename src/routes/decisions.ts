/**
 * Decision route handlers
 *
 * Handles decision journal operations and project context.
 */

import { Effect } from "effect"
import type { ServerResponse } from "http"
import type { ThinkingPartnerService } from "../services/ThinkingPartner.js"
import { sendJson } from "./shared.js"

export interface DecisionDeps {
  thinkingPartner: ThinkingPartnerService
}

export const handleGetDecisions = (
  deps: DecisionDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.thinkingPartner.getDecisions(projectId)).then(
    (decisions) => sendJson(res, 200, { ok: true, data: decisions }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleCreateDecision = (
  deps: DecisionDeps,
  res: ServerResponse,
  projectId: string,
  body: {
    title?: string
    description?: string
    alternatives?: string[]
    reasoning?: string
    tradeoffs?: string
  }
): void => {
  if (!body.title) {
    sendJson(res, 400, { ok: false, error: "title is required" })
    return
  }
  Effect.runPromise(deps.thinkingPartner.logDecision(projectId, {
    title: body.title,
    description: body.description || "",
    alternatives: body.alternatives || [],
    reasoning: body.reasoning || "",
    tradeoffs: body.tradeoffs || "",
  })).then(
    (decision) => sendJson(res, 201, { ok: true, data: decision }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}

export const handleGetProjectContext = (
  deps: DecisionDeps,
  res: ServerResponse,
  projectId: string
): void => {
  Effect.runPromise(deps.thinkingPartner.getProjectContext(projectId)).then(
    (context) => sendJson(res, 200, { ok: true, data: { context } }),
    () => sendJson(res, 500, { ok: false, error: "Internal server error" })
  )
}
