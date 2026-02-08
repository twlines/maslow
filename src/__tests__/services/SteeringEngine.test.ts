/**
 * Unit Tests for SteeringEngine Service
 *
 * Tests correction capture, query filtering, and prompt block formatting.
 * Uses mocked AppPersistence dependency.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { SteeringEngine, SteeringEngineLive } from "../../services/SteeringEngine.js"
import {
  AppPersistence,
  type AppPersistenceService,
  type SteeringCorrection,
  type CorrectionDomain,
} from "../../services/AppPersistence.js"

// In-memory correction store
let corrections: SteeringCorrection[] = []

const mockAppPersistence: AppPersistenceService = {
  addCorrection: (correction, domain, source, context, projectId) =>
    Effect.sync(() => {
      const entry: SteeringCorrection = {
        id: `cor-${corrections.length + 1}`,
        correction,
        domain,
        source,
        context: context ?? null,
        projectId: projectId ?? null,
        active: true,
        createdAt: Date.now(),
      }
      corrections.push(entry)
      return entry
    }),
  getCorrections: (opts) =>
    Effect.sync(() => {
      let result = corrections
      const activeOnly = opts?.activeOnly ?? true
      if (activeOnly) {
        result = result.filter((c) => c.active)
      }
      if (opts?.domain) {
        result = result.filter((c) => c.domain === opts.domain)
      }
      if (opts?.projectId !== undefined) {
        result = result.filter((c) => c.projectId === opts.projectId || c.projectId === null)
      }
      return result
    }),
  deactivateCorrection: (id) =>
    Effect.sync(() => {
      const c = corrections.find((c) => c.id === id)
      if (c) c.active = false
    }),
  reactivateCorrection: (id) =>
    Effect.sync(() => {
      const c = corrections.find((c) => c.id === id)
      if (c) c.active = true
    }),
  deleteCorrection: (id) =>
    Effect.sync(() => {
      corrections = corrections.filter((c) => c.id !== id)
    }),
  // Stubs for unused methods
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
  getActiveConversation: () => Effect.succeed(null),
  createConversation: () => Effect.succeed(null as never),
  updateConversationSession: () => Effect.void,
  updateConversationContext: () => Effect.void,
  archiveConversation: () => Effect.void,
  getRecentConversations: () => Effect.succeed([]),
  incrementMessageCount: () => Effect.void,
  getProjects: () => Effect.succeed([]),
  getProject: () => Effect.succeed(null),
  createProject: () => Effect.succeed(null as never),
  updateProject: () => Effect.void,
  getProjectDocuments: () => Effect.succeed([]),
  getProjectDocument: () => Effect.succeed(null),
  createProjectDocument: () => Effect.succeed(null as never),
  updateProjectDocument: () => Effect.void,
  getCards: () => Effect.succeed([]),
  getCard: () => Effect.succeed(null),
  createCard: () => Effect.succeed(null as never),
  updateCard: () => Effect.void,
  deleteCard: () => Effect.void,
  moveCard: () => Effect.void,
  getNextCard: () => Effect.succeed(null),
  saveCardContext: () => Effect.void,
  assignCardAgent: () => Effect.void,
  updateCardAgentStatus: () => Effect.void,
  startCard: () => Effect.void,
  completeCard: () => Effect.void,
  skipCardToBack: () => Effect.void,
  logAudit: () => Effect.void,
  insertTokenUsage: () => Effect.succeed(null as never),
  getDecisions: () => Effect.succeed([]),
  getDecision: () => Effect.succeed(null),
  createDecision: () => Effect.succeed(null as never),
  updateDecision: () => Effect.void,
  getUsageSummary: () => Effect.succeed(null as never),
}

const testLayer = SteeringEngineLive.pipe(
  Layer.provide(Layer.succeed(AppPersistence, mockAppPersistence))
)

const runWithSteering = <A>(
  effect: Effect.Effect<A, unknown, SteeringEngine>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, testLayer))

describe("SteeringEngine Service", () => {
  beforeEach(() => {
    corrections = []
  })

  describe("capture", () => {
    it("should record a correction", async () => {
      const result = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.capture(
            "Always use Effect.sync for sync operations",
            "code-pattern",
            "explicit",
            "Seen in code review"
          )
        })
      )

      expect(result.correction).toBe("Always use Effect.sync for sync operations")
      expect(result.domain).toBe("code-pattern")
      expect(result.source).toBe("explicit")
      expect(result.context).toBe("Seen in code review")
      expect(result.active).toBe(true)
    })

    it("should handle optional context and projectId", async () => {
      const result = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.capture(
            "Prefer functional style",
            "style",
            "agent-feedback"
          )
        })
      )

      expect(result.context).toBeNull()
      expect(result.projectId).toBeNull()
    })

    it("should associate correction with project", async () => {
      const result = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.capture(
            "Use specific error types",
            "architecture",
            "pr-rejection",
            "PR #42 feedback",
            "project-123"
          )
        })
      )

      expect(result.projectId).toBe("project-123")
    })
  })

  describe("query", () => {
    it("should return all active corrections by default", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Correction 1", "code-pattern", "explicit")
          yield* engine.capture("Correction 2", "style", "explicit")
          const all = yield* engine.query()
          expect(all).toHaveLength(2)
        })
      )
    })

    it("should filter by domain", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Code rule", "code-pattern", "explicit")
          yield* engine.capture("Style rule", "style", "explicit")
          const codeOnly = yield* engine.query({ domain: "code-pattern" })
          expect(codeOnly).toHaveLength(1)
          expect(codeOnly[0].domain).toBe("code-pattern")
        })
      )
    })

    it("should exclude deactivated corrections when activeOnly", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          const c = yield* engine.capture("Will deactivate", "style", "explicit")
          yield* engine.deactivate(c.id)
          const active = yield* engine.query()
          expect(active).toHaveLength(0)
        })
      )
    })
  })

  describe("deactivate / reactivate", () => {
    it("should deactivate a correction", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          const c = yield* engine.capture("Test", "style", "explicit")
          yield* engine.deactivate(c.id)
          expect(corrections[0].active).toBe(false)
        })
      )
    })

    it("should reactivate a deactivated correction", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          const c = yield* engine.capture("Test", "style", "explicit")
          yield* engine.deactivate(c.id)
          yield* engine.reactivate(c.id)
          expect(corrections[0].active).toBe(true)
        })
      )
    })
  })

  describe("remove", () => {
    it("should permanently delete a correction", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          const c = yield* engine.capture("To delete", "style", "explicit")
          yield* engine.remove(c.id)
          expect(corrections).toHaveLength(0)
        })
      )
    })
  })

  describe("buildPromptBlock", () => {
    it("should return empty string when no corrections exist", async () => {
      const block = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.buildPromptBlock()
        })
      )

      expect(block).toBe("")
    })

    it("should format corrections grouped by domain", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Use Effect.sync for sync ops", "code-pattern", "explicit")
          yield* engine.capture("No semicolons", "style", "explicit")
          yield* engine.capture("Use double quotes", "style", "explicit")
        })
      )

      const block = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.buildPromptBlock()
        })
      )

      expect(block).toContain("## Steering Corrections (MANDATORY)")
      expect(block).toContain("### Code Patterns")
      expect(block).toContain("- Use Effect.sync for sync ops")
      expect(block).toContain("### Style")
      expect(block).toContain("- No semicolons")
      expect(block).toContain("- Use double quotes")
    })

    it("should only include active corrections", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Active rule", "code-pattern", "explicit")
          const inactive = yield* engine.capture("Inactive rule", "code-pattern", "explicit")
          yield* engine.deactivate(inactive.id)
        })
      )

      const block = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.buildPromptBlock()
        })
      )

      expect(block).toContain("- Active rule")
      expect(block).not.toContain("- Inactive rule")
    })

    it("should include mandatory instruction text", async () => {
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Some rule", "preference", "explicit")
        })
      )

      const block = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.buildPromptBlock()
        })
      )

      expect(block).toContain("Follow every one")
    })

    it("should use human-readable domain labels", async () => {
      const domains: CorrectionDomain[] = [
        "code-pattern",
        "communication",
        "architecture",
        "preference",
        "style",
        "process",
      ]

      for (const domain of domains) {
        corrections = []
        await runWithSteering(
          Effect.gen(function* () {
            const engine = yield* SteeringEngine
            yield* engine.capture(`Rule for ${domain}`, domain, "explicit")
          })
        )
      }

      // Build with all domains present
      corrections = []
      await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          yield* engine.capture("Code rule", "code-pattern", "explicit")
          yield* engine.capture("Comm rule", "communication", "explicit")
          yield* engine.capture("Arch rule", "architecture", "explicit")
          yield* engine.capture("Pref rule", "preference", "explicit")
          yield* engine.capture("Style rule", "style", "explicit")
          yield* engine.capture("Process rule", "process", "explicit")
        })
      )

      const block = await runWithSteering(
        Effect.gen(function* () {
          const engine = yield* SteeringEngine
          return yield* engine.buildPromptBlock()
        })
      )

      expect(block).toContain("### Code Patterns")
      expect(block).toContain("### Communication")
      expect(block).toContain("### Architecture")
      expect(block).toContain("### Preferences")
      expect(block).toContain("### Style")
      expect(block).toContain("### Process")
    })
  })
})
