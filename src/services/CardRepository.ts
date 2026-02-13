/**
 * Card Repository
 *
 * Extracted from AppPersistence — owns all kanban card data access
 * including work queue logic (getNextCard, skipCardToBack, etc.).
 */

import { Effect } from "effect"
import { randomUUID } from "crypto"
import type Database from "better-sqlite3"
import type { AppKanbanCard, AgentType, AgentStatus } from "./AppPersistence.js"

export interface CardRepositoryMethods {
  getCards(projectId: string): Effect.Effect<AppKanbanCard[]>
  getCard(id: string): Effect.Effect<AppKanbanCard | null>
  createCard(projectId: string, title: string, description: string, column?: string): Effect.Effect<AppKanbanCard>
  updateCard(id: string, updates: Partial<{ title: string; description: string; column: string; labels: string[]; dueDate: number; position: number }>): Effect.Effect<void>
  deleteCard(id: string): Effect.Effect<void>
  moveCard(id: string, column: string, position: number): Effect.Effect<void>
  getNextCard(projectId: string): Effect.Effect<AppKanbanCard | null>
  saveCardContext(id: string, snapshot: string, sessionId?: string): Effect.Effect<void>
  assignCardAgent(id: string, agent: AgentType): Effect.Effect<void>
  updateCardAgentStatus(id: string, status: AgentStatus, reason?: string): Effect.Effect<void>
  startCard(id: string): Effect.Effect<void>
  completeCard(id: string): Effect.Effect<void>
  skipCardToBack(id: string, projectId: string): Effect.Effect<void>
}

const mapCardRow = (r: Record<string, unknown>): AppKanbanCard => ({
  id: r.id as string,
  projectId: r.project_id as string,
  title: r.title as string,
  description: r.description as string,
  column: r.column as AppKanbanCard["column"],
  labels: JSON.parse(r.labels as string),
  dueDate: (r.due_date as number | null) ?? undefined,
  linkedDecisionIds: JSON.parse(r.linked_decision_ids as string),
  linkedMessageIds: JSON.parse(r.linked_message_ids as string),
  position: r.position as number,
  priority: (r.priority as number | null) ?? 0,
  contextSnapshot: (r.context_snapshot as string | null) ?? null,
  lastSessionId: (r.last_session_id as string | null) ?? null,
  assignedAgent: (r.assigned_agent as AgentType | null) ?? null,
  agentStatus: (r.agent_status as AgentStatus | null) ?? null,
  blockedReason: (r.blocked_reason as string | null) ?? null,
  startedAt: (r.started_at as number | null) ?? null,
  completedAt: (r.completed_at as number | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
})

export function createCardRepository(db: Database.Database): CardRepositoryMethods {
  const stmts = {
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
    skipCardSetPriority: db.prepare(`
      UPDATE kanban_cards SET priority = ?, assigned_agent = NULL WHERE id = ?
    `),
  }

  return {
    getCards: (projectId) =>
      Effect.sync(() => {
        const rows = stmts.getCards.all(projectId) as Record<string, unknown>[]
        return rows.map(mapCardRow)
      }),

    getCard: (id) =>
      Effect.sync(() => {
        const r = stmts.getCard.get(id) as Record<string, unknown> | undefined
        if (!r) return null
        return mapCardRow(r)
      }),

    createCard: (projectId, title, description, column = "backlog") =>
      Effect.sync(() => {
        const id = randomUUID()
        const now = Date.now()
        const maxRow = stmts.getMaxCardPosition.get(projectId, column) as Record<string, unknown> | undefined
        const position = ((maxRow?.max_pos as number | null) ?? -1) + 1
        stmts.createCard.run(id, projectId, title, description, column, position, now, now)
        return {
          id,
          projectId,
          title,
          description,
          column: column as AppKanbanCard["column"],
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
          createdAt: now,
          updatedAt: now,
        }
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
        )
      }),

    deleteCard: (id) =>
      Effect.sync(() => {
        stmts.deleteCard.run(id)
      }),

    moveCard: (id, column, position) =>
      Effect.sync(() => {
        stmts.moveCard.run(column, position, Date.now(), id)
      }),

    getNextCard: (projectId) =>
      Effect.sync(() => {
        const r = stmts.getNextCard.get(projectId) as Record<string, unknown> | undefined
        if (!r) return null
        return mapCardRow(r)
      }),

    saveCardContext: (id, snapshot, sessionId) =>
      Effect.sync(() => {
        stmts.saveCardContext.run(snapshot, sessionId ?? null, Date.now(), id)
      }),

    assignCardAgent: (id, agent) =>
      Effect.sync(() => {
        stmts.assignCardAgent.run(agent, Date.now(), id)
      }),

    updateCardAgentStatus: (id, status, reason) =>
      Effect.sync(() => {
        stmts.updateCardAgentStatus.run(status, reason ?? null, Date.now(), id)
      }),

    startCard: (id) =>
      Effect.sync(() => {
        const now = Date.now()
        stmts.startCard.run(now, now, id)
      }),

    completeCard: (id) =>
      Effect.sync(() => {
        const now = Date.now()
        stmts.completeCard.run(now, now, id)
      }),

    skipCardToBack: (id, projectId) =>
      Effect.sync(() => {
        const maxPos = stmts.getMaxBacklogPosition.get(projectId) as Record<string, unknown> | undefined
        const maxPri = stmts.getMaxBacklogPriority.get(projectId) as Record<string, unknown> | undefined
        const now = Date.now()
        stmts.moveCard.run("backlog", ((maxPos?.max_pos as number | null) ?? 0) + 1, now, id)
        stmts.updateCardAgentStatus.run("idle", null, now, id)
        stmts.skipCardSetPriority.run(((maxPri?.max_pri as number | null) ?? 0) + 1, id)
      }),
  }
}
