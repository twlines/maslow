/**
 * Steering Engine Service
 *
 * Persistent correction store that captures, stores, and injects
 * steering corrections into prompts. Corrections compound over time —
 * every mistake becomes a rule, every preference becomes permanent.
 *
 * Three operations:
 * - Capture: record a correction with domain and source
 * - Query: retrieve active corrections (optionally filtered)
 * - Inject: build a prompt block from active corrections for agent/session use
 */

import { Context, Effect, Layer } from "effect"
import { AppPersistence } from "./AppPersistence.js"
import type {
  CorrectionDomain,
  CorrectionSource,
  SteeringCorrection,
} from "@maslow/shared"

export interface SteeringEngineService {
  /** Record a new correction */
  capture(
    correction: string,
    domain: CorrectionDomain,
    source: CorrectionSource,
    context?: string,
    projectId?: string
  ): Effect.Effect<SteeringCorrection, never>

  /** Get all active corrections, optionally filtered */
  query(opts?: {
    domain?: CorrectionDomain
    projectId?: string | null
    activeOnly?: boolean
  }): Effect.Effect<SteeringCorrection[], never>

  /** Deactivate a correction (soft delete) */
  deactivate(id: string): Effect.Effect<void, never>

  /** Reactivate a previously deactivated correction */
  reactivate(id: string): Effect.Effect<void, never>

  /** Permanently delete a correction */
  remove(id: string): Effect.Effect<void, never>

  /**
   * Build a prompt injection block from active corrections.
   * Optionally scoped to a project (includes global + project-specific).
   * Returns empty string if no corrections exist.
   */
  buildPromptBlock(projectId?: string): Effect.Effect<string, never>
}

export class SteeringEngine extends Context.Tag("SteeringEngine")<
  SteeringEngine,
  SteeringEngineService
>() {}

export const SteeringEngineLive = Layer.effect(
  SteeringEngine,
  Effect.gen(function* () {
    const persistence = yield* AppPersistence

    const formatCorrections = (corrections: SteeringCorrection[]): string => {
      if (corrections.length === 0) return ""

      const grouped = new Map<CorrectionDomain, SteeringCorrection[]>()
      for (const c of corrections) {
        const existing = grouped.get(c.domain) ?? []
        existing.push(c)
        grouped.set(c.domain, existing)
      }

      const domainLabels: Record<CorrectionDomain, string> = {
        "code-pattern": "Code Patterns",
        "communication": "Communication",
        "architecture": "Architecture",
        "preference": "Preferences",
        "style": "Style",
        "process": "Process",
      }

      let block = "## Steering Corrections (MANDATORY)\n\n"
      block += "These are learned corrections from previous sessions. Follow every one.\n\n"

      for (const [domain, items] of grouped) {
        block += `### ${domainLabels[domain]}\n`
        for (const item of items) {
          block += `- ${item.correction}\n`
        }
        block += "\n"
      }

      return block
    }

    return {
      capture: (correction, domain, source, context, projectId) =>
        persistence.addCorrection(correction, domain, source, context, projectId),

      query: (opts) =>
        persistence.getCorrections(opts),

      deactivate: (id) =>
        persistence.deactivateCorrection(id),

      reactivate: (id) =>
        persistence.reactivateCorrection(id),

      remove: (id) =>
        persistence.deleteCorrection(id),

      buildPromptBlock: (projectId) =>
        Effect.gen(function* () {
          const corrections = yield* persistence.getCorrections({
            projectId: projectId ?? null,
            activeOnly: true,
          })
          return formatCorrections(corrections)
        }),
    }
  })
)
