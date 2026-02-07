/**
 * Kanban Service
 *
 * AI-driven project board management. Maslow can create cards from conversation,
 * move cards as work progresses, and prompt before starting work on cards.
 */

import { Context, Effect, Layer } from "effect";
import { AppPersistence, type AppKanbanCard } from "./AppPersistence.js";

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
        db.createCard(projectId, title, description, column),

      updateCard: (id, updates) => db.updateCard(id, updates),

      deleteCard: (id) => db.deleteCard(id),

      moveCard: (id, column) =>
        Effect.gen(function* () {
          const card = yield* db.getCard(id);
          if (!card) return;
          // Get existing cards in target column to determine position
          const cards = yield* db.getCards(card.projectId);
          const columnCards = cards.filter((c) => c.column === column);
          const maxPosition = columnCards.reduce(
            (max, c) => Math.max(max, c.position),
            -1
          );
          yield* db.moveCard(id, column, maxPosition + 1);
        }),

      createCardFromConversation: (projectId, conversationText) =>
        Effect.gen(function* () {
          // Extract a card title from the conversation text
          // Simple heuristic: use first sentence or first 80 chars
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
    };
  })
);
