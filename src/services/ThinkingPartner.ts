/**
 * Thinking Partner Service
 *
 * The intelligence layer that makes Maslow more than a chatbot.
 * Manages decision journals, assumption tracking, and project synthesis.
 */

import { Context, Effect, Layer } from "effect";
import { AppPersistence } from "./AppPersistence.js";
import type { Decision, ProjectDocument } from "@maslow/shared";

export interface ThinkingPartnerService {
  // Decision Journal
  logDecision(projectId: string, decision: {
    title: string;
    description: string;
    alternatives: string[];
    reasoning: string;
    tradeoffs: string;
  }): Effect.Effect<Decision>;

  getDecisions(projectId: string): Effect.Effect<Decision[]>;

  // Assumption Tracking
  addAssumption(projectId: string, assumption: string): Effect.Effect<ProjectDocument>;
  getAssumptions(projectId: string): Effect.Effect<ProjectDocument | null>;

  // Project State Summary
  updateStateSummary(projectId: string, summary: string): Effect.Effect<void>;
  getStateSummary(projectId: string): Effect.Effect<ProjectDocument | null>;

  // Project context for Claude sessions
  getProjectContext(projectId: string): Effect.Effect<string>;
}

export class ThinkingPartner extends Context.Tag("ThinkingPartner")<
  ThinkingPartner,
  ThinkingPartnerService
>() {}

export const ThinkingPartnerLive = Layer.effect(
  ThinkingPartner,
  Effect.gen(function* () {
    const db = yield* AppPersistence;

    return {
      logDecision: (projectId, decision) =>
        db.createDecision(
          projectId,
          decision.title,
          decision.description,
          decision.alternatives,
          decision.reasoning,
          decision.tradeoffs
        ),

      getDecisions: (projectId) => db.getDecisions(projectId),

      addAssumption: (projectId, assumption) =>
        Effect.gen(function* () {
          // Get existing assumptions doc or create one
          const docs = yield* db.getProjectDocuments(projectId);
          const existingDoc = docs.find(d => d.type === "assumptions");

          if (existingDoc) {
            // Append the new assumption
            const existingAssumptions = existingDoc.content;
            const updated = existingAssumptions
              ? `${existingAssumptions}\n- ${assumption}`
              : `- ${assumption}`;
            yield* db.updateProjectDocument(existingDoc.id, { content: updated });
            return { ...existingDoc, content: updated, updatedAt: Date.now() };
          } else {
            // Create new assumptions doc
            return yield* db.createProjectDocument(
              projectId,
              "assumptions",
              "Assumptions",
              `- ${assumption}`
            );
          }
        }),

      getAssumptions: (projectId) =>
        Effect.gen(function* () {
          const docs = yield* db.getProjectDocuments(projectId);
          return docs.find(d => d.type === "assumptions") || null;
        }),

      updateStateSummary: (projectId, summary) =>
        Effect.gen(function* () {
          const docs = yield* db.getProjectDocuments(projectId);
          const existingDoc = docs.find(d => d.type === "state");

          if (existingDoc) {
            yield* db.updateProjectDocument(existingDoc.id, { content: summary });
          } else {
            yield* db.createProjectDocument(projectId, "state", "Current State", summary);
          }
        }),

      getStateSummary: (projectId) =>
        Effect.gen(function* () {
          const docs = yield* db.getProjectDocuments(projectId);
          return docs.find(d => d.type === "state") || null;
        }),

      getProjectContext: (projectId) =>
        Effect.gen(function* () {
          const project = yield* db.getProject(projectId);
          if (!project) return "";

          const docs = yield* db.getProjectDocuments(projectId);
          const decisions = yield* db.getDecisions(projectId);

          let context = `# Project: ${project.name}\n\n`;
          context += `${project.description}\n\n`;

          // Add instruction set if exists
          const instructions = docs.find(d => d.type === "instructions");
          if (instructions) {
            context += `## Instructions\n${instructions.content}\n\n`;
          }

          // Add brief if exists
          const brief = docs.find(d => d.type === "brief");
          if (brief) {
            context += `## Brief\n${brief.content}\n\n`;
          }

          // Add state summary
          const state = docs.find(d => d.type === "state");
          if (state) {
            context += `## Current State\n${state.content}\n\n`;
          }

          // Add assumptions
          const assumptions = docs.find(d => d.type === "assumptions");
          if (assumptions) {
            context += `## Assumptions\n${assumptions.content}\n\n`;
          }

          // Add recent decisions
          if (decisions.length > 0) {
            context += `## Recent Decisions\n`;
            for (const d of decisions.slice(0, 10)) {
              context += `- **${d.title}**: ${d.description} (Reasoning: ${d.reasoning})\n`;
            }
            context += "\n";
          }

          return context;
        }),
    };
  })
);
