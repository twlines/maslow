/**
 * Unit Tests for ThinkingPartner Service
 *
 * Tests decision logging, assumption append, state summary,
 * and context assembly. Uses mocked AppPersistence dependency.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { ThinkingPartner, ThinkingPartnerLive } from "../../services/ThinkingPartner.js"
import {
  AppPersistence,
  type AppPersistenceService,
  type AppDecision,
  type AppProjectDocument,
  type AppProject,
} from "../../services/AppPersistence.js"

// In-memory stores
let decisions: AppDecision[] = []
let documents: AppProjectDocument[] = []
let projects: AppProject[] = []

const mockAppPersistence: AppPersistenceService = {
  createDecision: (projectId, title, description, alternatives, reasoning, tradeoffs) =>
    Effect.sync(() => {
      const decision: AppDecision = {
        id: `dec-${decisions.length + 1}`,
        projectId,
        title,
        description,
        alternatives,
        reasoning,
        tradeoffs,
        createdAt: Date.now(),
      }
      decisions.push(decision)
      return decision
    }),
  getDecisions: (projectId) =>
    Effect.sync(() => decisions.filter((d) => d.projectId === projectId)),
  getDecision: (id) =>
    Effect.sync(() => decisions.find((d) => d.id === id) ?? null),
  updateDecision: () => Effect.void,
  getProjectDocuments: (projectId) =>
    Effect.sync(() => documents.filter((d) => d.projectId === projectId)),
  getProjectDocument: (id) =>
    Effect.sync(() => documents.find((d) => d.id === id) ?? null),
  createProjectDocument: (projectId, type, title, content) =>
    Effect.sync(() => {
      const doc: AppProjectDocument = {
        id: `doc-${documents.length + 1}`,
        projectId,
        type,
        title,
        content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      documents.push(doc)
      return doc
    }),
  updateProjectDocument: (id, updates) =>
    Effect.sync(() => {
      const doc = documents.find((d) => d.id === id)
      if (doc) {
        if (updates.content !== undefined) doc.content = updates.content!
        if (updates.title !== undefined) doc.title = updates.title!
        doc.updatedAt = Date.now()
      }
    }),
  getProject: (id) =>
    Effect.sync(() => projects.find((p) => p.id === id) ?? null),
  getProjects: () => Effect.succeed(projects),
  createProject: () => Effect.succeed(null as never),
  updateProject: () => Effect.void,
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
  addCorrection: () => Effect.succeed(null as never),
  getCorrections: () => Effect.succeed([]),
  deactivateCorrection: () => Effect.void,
  reactivateCorrection: () => Effect.void,
  deleteCorrection: () => Effect.void,
  logAudit: () => Effect.void,
  insertTokenUsage: () => Effect.succeed(null as never),
  getUsageSummary: () => Effect.succeed(null as never),
}

const testLayer = ThinkingPartnerLive.pipe(
  Layer.provide(Layer.succeed(AppPersistence, mockAppPersistence))
)

const runWithTP = <A>(
  effect: Effect.Effect<A, unknown, ThinkingPartner>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, testLayer))

describe("ThinkingPartner Service", () => {
  beforeEach(() => {
    decisions = []
    documents = []
    projects = []
  })

  describe("logDecision", () => {
    it("should create a decision record", async () => {
      const decision = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.logDecision("p1", {
            title: "Use PostgreSQL",
            description: "Database choice for production",
            alternatives: ["MySQL", "SQLite"],
            reasoning: "Better JSON support and scalability",
            tradeoffs: "Requires separate server process",
          })
        })
      )

      expect(decision.title).toBe("Use PostgreSQL")
      expect(decision.alternatives).toEqual(["MySQL", "SQLite"])
      expect(decision.projectId).toBe("p1")
    })

    it("should persist multiple decisions", async () => {
      await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          yield* tp.logDecision("p1", {
            title: "Decision 1",
            description: "First",
            alternatives: [],
            reasoning: "Reason 1",
            tradeoffs: "None",
          })
          yield* tp.logDecision("p1", {
            title: "Decision 2",
            description: "Second",
            alternatives: [],
            reasoning: "Reason 2",
            tradeoffs: "None",
          })
          const all = yield* tp.getDecisions("p1")
          expect(all).toHaveLength(2)
        })
      )
    })
  })

  describe("addAssumption", () => {
    it("should create a new assumptions doc when none exists", async () => {
      const doc = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.addAssumption("p1", "Users have stable internet")
        })
      )

      expect(doc.type).toBe("assumptions")
      expect(doc.content).toBe("- Users have stable internet")
    })

    it("should append to existing assumptions doc", async () => {
      // Pre-seed an assumptions doc
      documents.push({
        id: "doc-existing",
        projectId: "p1",
        type: "assumptions",
        title: "Assumptions",
        content: "- First assumption",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const doc = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.addAssumption("p1", "Second assumption")
        })
      )

      expect(doc.content).toBe("- First assumption\n- Second assumption")
    })

    it("should handle appending to empty existing doc", async () => {
      documents.push({
        id: "doc-empty",
        projectId: "p1",
        type: "assumptions",
        title: "Assumptions",
        content: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const doc = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.addAssumption("p1", "New assumption")
        })
      )

      expect(doc.content).toBe("- New assumption")
    })
  })

  describe("getAssumptions", () => {
    it("should return the assumptions doc", async () => {
      documents.push({
        id: "doc-1",
        projectId: "p1",
        type: "assumptions",
        title: "Assumptions",
        content: "- Test assumption",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const result = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getAssumptions("p1")
        })
      )

      expect(result).not.toBeNull()
      expect(result?.content).toBe("- Test assumption")
    })

    it("should return null when no assumptions exist", async () => {
      const result = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getAssumptions("p1")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("updateStateSummary", () => {
    it("should create a state doc when none exists", async () => {
      await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          yield* tp.updateStateSummary("p1", "Project is in progress")
        })
      )

      const stateDoc = documents.find((d) => d.type === "state" && d.projectId === "p1")
      expect(stateDoc).not.toBeUndefined()
      expect(stateDoc?.content).toBe("Project is in progress")
    })

    it("should update existing state doc", async () => {
      documents.push({
        id: "doc-state",
        projectId: "p1",
        type: "state",
        title: "Current State",
        content: "Old state",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          yield* tp.updateStateSummary("p1", "New state")
        })
      )

      const stateDoc = documents.find((d) => d.id === "doc-state")
      expect(stateDoc?.content).toBe("New state")
    })
  })

  describe("getStateSummary", () => {
    it("should return the state doc", async () => {
      documents.push({
        id: "doc-state",
        projectId: "p1",
        type: "state",
        title: "Current State",
        content: "Active development phase",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const result = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getStateSummary("p1")
        })
      )

      expect(result?.content).toBe("Active development phase")
    })

    it("should return null when no state exists", async () => {
      const result = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getStateSummary("p1")
        })
      )

      expect(result).toBeNull()
    })
  })

  describe("getProjectContext", () => {
    it("should return empty string when project does not exist", async () => {
      const context = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getProjectContext("nonexistent")
        })
      )

      expect(context).toBe("")
    })

    it("should assemble context from project, docs, and decisions", async () => {
      projects.push({
        id: "p1",
        name: "Test Project",
        description: "A test project description",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      documents.push(
        {
          id: "doc-inst",
          projectId: "p1",
          type: "instructions",
          title: "Instructions",
          content: "Follow TDD",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "doc-brief",
          projectId: "p1",
          type: "brief",
          title: "Brief",
          content: "Build a chat app",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "doc-state",
          projectId: "p1",
          type: "state",
          title: "State",
          content: "In progress",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "doc-assumptions",
          projectId: "p1",
          type: "assumptions",
          title: "Assumptions",
          content: "- Users have internet",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      )

      decisions.push({
        id: "dec-1",
        projectId: "p1",
        title: "Use WebSockets",
        description: "For real-time messaging",
        alternatives: ["SSE", "Polling"],
        reasoning: "Lower latency",
        tradeoffs: "More complex",
        createdAt: Date.now(),
      })

      const context = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getProjectContext("p1")
        })
      )

      expect(context).toContain("# Project: Test Project")
      expect(context).toContain("A test project description")
      expect(context).toContain("## Instructions")
      expect(context).toContain("Follow TDD")
      expect(context).toContain("## Brief")
      expect(context).toContain("Build a chat app")
      expect(context).toContain("## Current State")
      expect(context).toContain("In progress")
      expect(context).toContain("## Assumptions")
      expect(context).toContain("- Users have internet")
      expect(context).toContain("## Recent Decisions")
      expect(context).toContain("Use WebSockets")
    })

    it("should limit decisions to 10", async () => {
      projects.push({
        id: "p1",
        name: "Project",
        description: "Desc",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      for (let i = 0; i < 15; i++) {
        decisions.push({
          id: `dec-${i}`,
          projectId: "p1",
          title: `Decision ${i}`,
          description: `Description ${i}`,
          alternatives: [],
          reasoning: `Reasoning ${i}`,
          tradeoffs: "",
          createdAt: Date.now(),
        })
      }

      const context = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getProjectContext("p1")
        })
      )

      // Should contain first 10 decisions (0-9) but not 10-14
      const decisionMatches = context.match(/Decision \d+/g)
      expect(decisionMatches?.length).toBe(10)
    })

    it("should handle project with no docs or decisions", async () => {
      projects.push({
        id: "p1",
        name: "Empty Project",
        description: "No docs here",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const context = await runWithTP(
        Effect.gen(function* () {
          const tp = yield* ThinkingPartner
          return yield* tp.getProjectContext("p1")
        })
      )

      expect(context).toContain("# Project: Empty Project")
      expect(context).not.toContain("## Instructions")
      expect(context).not.toContain("## Recent Decisions")
    })
  })
})
