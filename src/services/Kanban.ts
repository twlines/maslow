/**
 * Kanban Service
 *
 * AI-driven project board management. Maslow can create cards from conversation,
 * move cards as work progresses, and prompt before starting work on cards.
 */

import { Context, Effect, Layer } from "effect";
import { AppPersistence, type AppKanbanCard, type AgentType, type AgentStatus } from "./AppPersistence.js";

export interface KanbanService {
  // Board operations
  getBoard(projectId: string): Effect.Effect<{
    backlog: AppKanbanCard[];
    in_progress: AppKanbanCard[];
    done: AppKanbanCard[];
  }>;

  // Card CRUD
  createCard(
    projectId: string,
    title: string,
    description?: string,
    column?: string
  ): Effect.Effect<AppKanbanCard>;
  updateCard(
    id: string,
    updates: Partial<{
      title: string;
      description: string;
      labels: string[];
      dueDate: number;
    }>
  ): Effect.Effect<void>;
  deleteCard(id: string): Effect.Effect<void>;

  // Card movement
  moveCard(
    id: string,
    column: "backlog" | "in_progress" | "done"
  ): Effect.Effect<void>;

  // AI-driven operations
  createCardFromConversation(
    projectId: string,
    conversationText: string
  ): Effect.Effect<AppKanbanCard>;

  // Work queue operations
  getNext(projectId: string): Effect.Effect<AppKanbanCard | null>;
  skipToBack(id: string): Effect.Effect<void>;
  saveContext(id: string, snapshot: string, sessionId?: string): Effect.Effect<void>;
  resume(id: string): Effect.Effect<{ card: AppKanbanCard; context: string | null } | null>;
  assignAgent(id: string, agent: AgentType): Effect.Effect<void>;
  updateAgentStatus(id: string, status: AgentStatus, reason?: string): Effect.Effect<void>;
  startWork(id: string, agent?: AgentType): Effect.Effect<void>;
  completeWork(id: string): Effect.Effect<void>;
}

export class Kanban extends Context.Tag("Kanban")<Kanban, KanbanService>() {}

export const KanbanLive = Layer.effect(
  Kanban,
  Effect.gen(function* () {
    const db = yield* AppPersistence;

    return {
      getBoard: (projectId) =>
        Effect.gen(function* () {
          const cards = yield* db.getCards(projectId);
          return {
            backlog: cards
              .filter((c) => c.column === "backlog")
              .sort((a, b) => a.position - b.position),
            in_progress: cards
              .filter((c) => c.column === "in_progress")
              .sort((a, b) => a.position - b.position),
            done: cards
              .filter((c) => c.column === "done")
              .sort((a, b) => a.position - b.position),
          };
        }),

      createCard: (projectId, title, description = "", column = "backlog") =>
        Effect.gen(function* () {
          const card = yield* db.createCard(projectId, title, description, column)
          yield* db.logAudit("kanban_card", card.id, "card.created", {
            projectId,
            title,
            column,
          })
          return card
        }),

      updateCard: (id, updates) => db.updateCard(id, updates),

      deleteCard: (id) =>
        Effect.gen(function* () {
          const card = yield* db.getCard(id)
          yield* db.deleteCard(id)
          yield* db.logAudit("kanban_card", id, "card.deleted", {
            title: card?.title,
            column: card?.column,
          })
        }),

      moveCard: (id, column) =>
        Effect.gen(function* () {
          const card = yield* db.getCard(id);
          if (!card) return;
          const fromColumn = card.column
          // Get existing cards in target column to determine position
          const cards = yield* db.getCards(card.projectId);
          const columnCards = cards.filter((c) => c.column === column);
          const maxPosition = columnCards.reduce(
            (max, c) => Math.max(max, c.position),
            -1
          );
          yield* db.moveCard(id, column, maxPosition + 1);
          yield* db.logAudit("kanban_card", id, "card.moved", {
            from: fromColumn,
            to: column,
          })
        }),

      createCardFromConversation: (projectId, conversationText) =>
        Effect.gen(function* () {
          const firstSentence = conversationText.split(/[.!?]\s/)[0];
          const title =
            firstSentence.length > 80
              ? firstSentence.slice(0, 77) + "..."
              : firstSentence;
          const card = yield* db.createCard(
            projectId,
            title,
            conversationText,
            "backlog"
          );
          return card;
        }),

      // Work queue operations

      getNext: (projectId) => db.getNextCard(projectId),

      skipToBack: (id) =>
        Effect.gen(function* () {
          const card = yield* db.getCard(id);
          if (!card) return;
          yield* db.skipCardToBack(id, card.projectId);
          yield* db.logAudit("kanban_card", id, "card.skipped_to_back", {
            projectId: card.projectId,
          })
        }),

      saveContext: (id, snapshot, sessionId) =>
        db.saveCardContext(id, snapshot, sessionId),

      resume: (id) =>
        Effect.gen(function* () {
          const card = yield* db.getCard(id);
          if (!card) return null;
          return { card, context: card.contextSnapshot };
        }),

      assignAgent: (id, agent) => db.assignCardAgent(id, agent),

      updateAgentStatus: (id, status, reason) =>
        db.updateCardAgentStatus(id, status, reason),

      startWork: (id, agent) =>
        Effect.gen(function* () {
          yield* db.startCard(id);
          if (agent) {
            yield* db.assignCardAgent(id, agent);
          }
          yield* db.logAudit("kanban_card", id, "card.started", {
            agent: agent ?? null,
          })
        }),

      completeWork: (id) =>
        Effect.gen(function* () {
          yield* db.completeCard(id)
          yield* db.logAudit("kanban_card", id, "card.completed")
        }),
    };
  })
);
