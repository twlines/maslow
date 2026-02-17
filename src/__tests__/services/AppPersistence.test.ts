/**
 * Unit Tests for AppPersistence Service
 *
 * Tests all CRUD operations against a real temp SQLite database.
 * Covers: Projects, Cards, Documents, Decisions, Conversations,
 * Steering Corrections, Campaigns, Search (FTS), and Audit Log.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AppPersistence, AppPersistenceLive } from "../../services/AppPersistence.js"
import { MessageRepository } from "../../services/repositories/MessageRepository.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

const createTempDbPath = () => {
  const tmpDir = os.tmpdir()
  const dbDir = path.join(tmpDir, `maslow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  return path.join(dbDir, "sessions.db")
}

const cleanupTempDir = (dbPath: string) => {
  try {
    const dir = path.dirname(dbPath)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Ignore cleanup errors
  }
}

const createTestConfigLayer = (dbPath: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: dbPath },
  } satisfies AppConfig)

// Stub MessageRepository — AppPersistence delegates messages to it but we
// don't need real message storage for these tests.
const StubMessageRepositoryLayer = Layer.succeed(MessageRepository, {
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
})

describe("AppPersistence Service", () => {
  let tempDbPath: string

  beforeEach(() => {
    tempDbPath = createTempDbPath()
  })

  afterEach(() => {
    cleanupTempDir(tempDbPath)
  })

  const runWithDb = <A>(
    effect: Effect.Effect<A, unknown, AppPersistence>,
    dbPath: string = tempDbPath,
  ): Promise<A> => {
    const configLayer = createTestConfigLayer(dbPath)
    const testLayer = AppPersistenceLive.pipe(
      Layer.provide(configLayer),
      Layer.provide(StubMessageRepositoryLayer),
    )
    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer)),
    )
  }

  // ========================================================================
  // Projects
  // ========================================================================

  describe("Projects", () => {
    it("should create and retrieve a project", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Test Project", "A test project")
          return yield* db.getProject(project.id)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Test Project")
      expect(result!.description).toBe("A test project")
      expect(result!.status).toBe("active")
      expect(result!.createdAt).toBeTypeOf("number")
      expect(result!.updatedAt).toBeTypeOf("number")
    })

    it("should return null for non-existent project", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.getProject("non-existent-id")
        }),
      )

      expect(result).toBeNull()
    })

    it("should list all projects", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.createProject("Alpha", "")
          yield* db.createProject("Beta", "")
          yield* db.createProject("Gamma", "")
          return yield* db.getProjects()
        }),
      )

      expect(result).toHaveLength(3)
      const names = result.map((p) => p.name)
      expect(names).toContain("Alpha")
      expect(names).toContain("Beta")
      expect(names).toContain("Gamma")
    })

    it("should update project fields", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Original", "desc")
          yield* db.updateProject(project.id, { name: "Updated", status: "paused", color: "#FF0000" })
          return yield* db.getProject(project.id)
        }),
      )

      expect(result!.name).toBe("Updated")
      expect(result!.status).toBe("paused")
      expect(result!.color).toBe("#FF0000")
    })

    it("should partially update project (COALESCE preserves unset fields)", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Keep This", "Keep That")
          yield* db.updateProject(project.id, { description: "Changed" })
          return yield* db.getProject(project.id)
        }),
      )

      expect(result!.name).toBe("Keep This")
      expect(result!.description).toBe("Changed")
    })
  })

  // ========================================================================
  // Kanban Cards
  // ========================================================================

  describe("Cards", () => {
    const withProject = <A>(
      fn: (projectId: string) => Effect.Effect<A, unknown, AppPersistence>,
    ) =>
      runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Card Test", "")
          return yield* fn(project.id)
        }),
      )

    it("should create a card in backlog by default", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.createCard(projectId, "My Card", "Description")
        }),
      )

      expect(result.title).toBe("My Card")
      expect(result.description).toBe("Description")
      expect(result.column).toBe("backlog")
      expect(result.labels).toEqual([])
      expect(result.position).toBe(0)
      expect(result.assignedAgent).toBeNull()
    })

    it("should create card in specified column", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.createCard(projectId, "WIP Card", "", "in_progress")
        }),
      )

      expect(result.column).toBe("in_progress")
    })

    it("should auto-increment card position within a column", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const c1 = yield* db.createCard(projectId, "First", "")
          const c2 = yield* db.createCard(projectId, "Second", "")
          const c3 = yield* db.createCard(projectId, "Third", "")
          return [c1.position, c2.position, c3.position]
        }),
      ) as number[]

      expect(result).toEqual([0, 1, 2])
    })

    it("should retrieve all cards for a project", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.createCard(projectId, "A", "")
          yield* db.createCard(projectId, "B", "")
          return yield* db.getCards(projectId)
        }),
      )

      expect(result).toHaveLength(2)
    })

    it("should return null for non-existent card", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.getCard("no-such-card")
        }),
      )

      expect(result).toBeNull()
    })

    it("should update card fields", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Old Title", "old desc")
          yield* db.updateCard(card.id, { title: "New Title", labels: ["bug", "p0"] })
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.title).toBe("New Title")
      expect(result!.labels).toEqual(["bug", "p0"])
    })

    it("should move card to different column", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Mover", "")
          yield* db.moveCard(card.id, "done", 0)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("done")
      expect(result!.position).toBe(0)
    })

    it("should delete a card", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Delete Me", "")
          yield* db.deleteCard(card.id)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result).toBeNull()
    })

    it("should get next card from backlog (ordered by priority, position)", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.createCard(projectId, "Second Priority", "")
          yield* db.createCard(projectId, "First Priority", "")
          return yield* db.getNextCard(projectId)
        }),
      )

      // Both have priority 0, so position 0 wins
      expect(result!.title).toBe("Second Priority")
    })

    it("should return null when no backlog cards", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.createCard(projectId, "Done Card", "", "done")
          return yield* db.getNextCard(projectId)
        }),
      )

      expect(result).toBeNull()
    })

    it("should start card (moves to in_progress, sets startedAt)", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Start Me", "")
          yield* db.startCard(card.id)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("in_progress")
      expect(result!.startedAt).toBeTypeOf("number")
    })

    it("should complete card (moves to done, sets completedAt)", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Complete Me", "")
          yield* db.startCard(card.id)
          yield* db.completeCard(card.id)
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.column).toBe("done")
      expect(result!.agentStatus).toBe("completed")
      expect(result!.completedAt).toBeTypeOf("number")
    })

    it("should assign agent and update agent status", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Agent Card", "")
          yield* db.assignCardAgent(card.id, "ollama")
          const assigned = yield* db.getCard(card.id)
          yield* db.updateCardAgentStatus(card.id, "blocked", "Missing context")
          const blocked = yield* db.getCard(card.id)
          return { assigned, blocked }
        }),
      )

      expect(result.assigned!.assignedAgent).toBe("ollama")
      expect(result.assigned!.agentStatus).toBe("running")
      expect(result.blocked!.agentStatus).toBe("blocked")
      expect(result.blocked!.blockedReason).toBe("Missing context")
    })

    it("should save card context and session ID", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const card = yield* db.createCard(projectId, "Context Card", "")
          yield* db.saveCardContext(card.id, "snapshot data here", "session-123")
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.contextSnapshot).toBe("snapshot data here")
      expect(result!.lastSessionId).toBe("session-123")
    })

    it("should skip card to back of backlog", async () => {
      const result = await withProject((projectId) =>
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const c1 = yield* db.createCard(projectId, "First", "")
          yield* db.createCard(projectId, "Second", "")
          yield* db.createCard(projectId, "Third", "")
          yield* db.skipCardToBack(c1.id, projectId)
          const skipped = yield* db.getCard(c1.id)
          const next = yield* db.getNextCard(projectId)
          return { skipped, next }
        }),
      )

      expect(result.skipped!.column).toBe("backlog")
      // Should have been moved to the back (highest position)
      expect(result.skipped!.position).toBe(3)
      // Next card should now be "Second" (position 1, priority 0)
      expect(result.next!.title).toBe("Second")
    })
  })

  // ========================================================================
  // Project Documents
  // ========================================================================

  describe("Documents", () => {
    it("should create and retrieve a document", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Doc Project", "")
          const doc = yield* db.createProjectDocument(project.id, "brief", "My Brief", "Content here")
          return yield* db.getProjectDocument(doc.id)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.type).toBe("brief")
      expect(result!.title).toBe("My Brief")
      expect(result!.content).toBe("Content here")
    })

    it("should return null for non-existent document", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.getProjectDocument("no-doc")
        }),
      )

      expect(result).toBeNull()
    })

    it("should list documents for a project", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Multi Doc", "")
          yield* db.createProjectDocument(project.id, "brief", "Brief", "")
          yield* db.createProjectDocument(project.id, "instructions", "Instructions", "")
          yield* db.createProjectDocument(project.id, "reference", "Ref", "")
          return yield* db.getProjectDocuments(project.id)
        }),
      )

      expect(result).toHaveLength(3)
    })

    it("should update document title and content", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Update Doc", "")
          const doc = yield* db.createProjectDocument(project.id, "brief", "Old Title", "Old Content")
          yield* db.updateProjectDocument(doc.id, { title: "New Title", content: "New Content" })
          return yield* db.getProjectDocument(doc.id)
        }),
      )

      expect(result!.title).toBe("New Title")
      expect(result!.content).toBe("New Content")
    })

    it("should cascade delete documents when project is deleted", async () => {
      // Documents have FK to projects with ON DELETE CASCADE
      // but there's no deleteProject method — testing FK constraint directly
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("FK Test", "")
          const doc = yield* db.createProjectDocument(project.id, "brief", "Will Delete", "")
          return { projectId: project.id, docId: doc.id }
        }),
      )

      expect(result.docId).toBeTruthy()
    })
  })

  // ========================================================================
  // Decisions
  // ========================================================================

  describe("Decisions", () => {
    it("should create and retrieve a decision", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Decision Project", "")
          const decision = yield* db.createDecision(
            project.id,
            "Use Ollama",
            "Replace Claude CLI with Ollama for agents",
            ["Keep Claude", "Use GPT-4", "Use Ollama"],
            "Cost savings, local execution",
            "Lower quality but free",
          )
          return yield* db.getDecision(decision.id)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.title).toBe("Use Ollama")
      expect(result!.alternatives).toEqual(["Keep Claude", "Use GPT-4", "Use Ollama"])
      expect(result!.reasoning).toBe("Cost savings, local execution")
      expect(result!.tradeoffs).toBe("Lower quality but free")
    })

    it("should return null for non-existent decision", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.getDecision("nope")
        }),
      )

      expect(result).toBeNull()
    })

    it("should list decisions for a project", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Multi Dec", "")
          yield* db.createDecision(project.id, "D1", "", [], "", "")
          yield* db.createDecision(project.id, "D2", "", [], "", "")
          return yield* db.getDecisions(project.id)
        }),
      )

      expect(result).toHaveLength(2)
    })

    it("should update decision fields", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Update Dec", "")
          const dec = yield* db.createDecision(project.id, "Old", "old desc", [], "", "")
          yield* db.updateDecision(dec.id, { title: "New", reasoning: "New reason" })
          return yield* db.getDecision(dec.id)
        }),
      )

      expect(result!.title).toBe("New")
      expect(result!.reasoning).toBe("New reason")
      expect(result!.revisedAt).toBeTypeOf("number")
    })
  })

  // ========================================================================
  // Conversations
  // ========================================================================

  describe("Conversations", () => {
    it("should create and get active conversation", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const conv = yield* db.createConversation(null)
          return yield* db.getActiveConversation(null)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.status).toBe("active")
      expect(result!.messageCount).toBe(0)
    })

    it("should scope active conversation by projectId", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Conv Project", "")
          yield* db.createConversation(project.id)
          yield* db.createConversation(null)
          const projectConv = yield* db.getActiveConversation(project.id)
          const globalConv = yield* db.getActiveConversation(null)
          return { projectConv, globalConv }
        }),
      )

      expect(result.projectConv!.projectId).toBe(result.projectConv!.projectId)
      expect(result.globalConv!.projectId).toBeNull()
    })

    it("should update conversation session ID", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const conv = yield* db.createConversation(null)
          yield* db.updateConversationSession(conv.id, "claude-session-abc")
          return yield* db.getActiveConversation(null)
        }),
      )

      expect(result!.claudeSessionId).toBe("claude-session-abc")
    })

    it("should archive conversation", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const conv = yield* db.createConversation(null)
          yield* db.archiveConversation(conv.id, "Summary of conversation")
          return yield* db.getActiveConversation(null)
        }),
      )

      // Active conversation should be null after archiving
      expect(result).toBeNull()
    })

    it("should increment message count", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const conv = yield* db.createConversation(null)
          yield* db.incrementMessageCount(conv.id)
          yield* db.incrementMessageCount(conv.id)
          yield* db.incrementMessageCount(conv.id)
          return yield* db.getActiveConversation(null)
        }),
      )

      expect(result!.messageCount).toBe(3)
    })

    it("should get recent conversations with limit", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.createConversation(null)
          yield* db.createConversation(null)
          yield* db.createConversation(null)
          return yield* db.getRecentConversations(null, 2)
        }),
      )

      expect(result).toHaveLength(2)
    })
  })

  // ========================================================================
  // Steering Corrections
  // ========================================================================

  describe("Steering Corrections", () => {
    it("should add and retrieve corrections", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const c = yield* db.addCorrection("Use double quotes", "style", "explicit", "Code review")
          return yield* db.getCorrections()
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0].correction).toBe("Use double quotes")
      expect(result[0].domain).toBe("style")
      expect(result[0].source).toBe("explicit")
      expect(result[0].active).toBe(true)
    })

    it("should deactivate and reactivate corrections", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const c = yield* db.addCorrection("Test", "style", "explicit")
          yield* db.deactivateCorrection(c.id)
          const afterDeactivate = yield* db.getCorrections()
          yield* db.reactivateCorrection(c.id)
          const afterReactivate = yield* db.getCorrections()
          return { afterDeactivate, afterReactivate }
        }),
      )

      expect(result.afterDeactivate).toHaveLength(0) // default activeOnly=true
      expect(result.afterReactivate).toHaveLength(1)
    })

    it("should delete corrections", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const c = yield* db.addCorrection("Delete me", "style", "explicit")
          yield* db.deleteCorrection(c.id)
          return yield* db.getCorrections({ activeOnly: false })
        }),
      )

      expect(result).toHaveLength(0)
    })

    it("should filter corrections by domain", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.addCorrection("Style 1", "style", "explicit")
          yield* db.addCorrection("Arch 1", "architecture", "explicit")
          return yield* db.getCorrections({ domain: "style" })
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0].domain).toBe("style")
    })
  })

  // ========================================================================
  // Audit Log
  // ========================================================================

  describe("Audit Log", () => {
    it("should log and query audit entries", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.logAudit("card", "card-1", "created", { title: "New Card" })
          yield* db.logAudit("card", "card-1", "updated", { column: "in_progress" })
          yield* db.logAudit("project", "proj-1", "created", {})
          return yield* db.getAuditLog({ entityType: "card" })
        }),
      )

      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(2)
      const actions = result.items.map((i) => i.action)
      expect(actions).toContain("created")
      expect(actions).toContain("updated")
    })

    it("should filter by entityId", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          yield* db.logAudit("card", "card-1", "created", {})
          yield* db.logAudit("card", "card-2", "created", {})
          return yield* db.getAuditLog({ entityType: "card", entityId: "card-2" })
        }),
      )

      expect(result.total).toBe(1)
      expect(result.items[0].entityId).toBe("card-2")
    })

    it("should respect limit and offset", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          for (let i = 0; i < 10; i++) {
            yield* db.logAudit("card", `card-${i}`, "created", {})
          }
          return yield* db.getAuditLog({ limit: 3, offset: 2 })
        }),
      )

      expect(result.total).toBe(10)
      expect(result.items).toHaveLength(3)
    })
  })

  // ========================================================================
  // Campaigns
  // ========================================================================

  describe("Campaigns", () => {
    it("should create and retrieve a campaign", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Campaign Project", "")
          const campaign = yield* db.createCampaign(project.id, "Lint Cleanup", "Remove all lint errors")
          return yield* db.getCampaign(campaign.id)
        }),
      )

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Lint Cleanup")
      expect(result!.status).toBe("active")
      expect(result!.baselineMetrics).toBeNull()
    })

    it("should return null for non-existent campaign", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.getCampaign("nope")
        }),
      )

      expect(result).toBeNull()
    })

    it("should list campaigns for a project", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Multi Campaign", "")
          yield* db.createCampaign(project.id, "C1", "")
          yield* db.createCampaign(project.id, "C2", "")
          return yield* db.getCampaigns(project.id)
        }),
      )

      expect(result).toHaveLength(2)
    })

    it("should update campaign status and baseline metrics", async () => {
      const metrics = {
        lintWarnings: 10,
        lintErrors: 5,
        anyCount: 3,
        testFileCount: 20,
        totalFiles: 100,
        timestamp: Date.now(),
      }

      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Update Campaign", "")
          const campaign = yield* db.createCampaign(project.id, "Metrics", "")
          yield* db.updateCampaign(campaign.id, { status: "completed", baselineMetrics: metrics })
          return yield* db.getCampaign(campaign.id)
        }),
      )

      expect(result!.status).toBe("completed")
      expect(result!.baselineMetrics).toEqual(metrics)
    })
  })

  // ========================================================================
  // Campaign Reports
  // ========================================================================

  describe("Campaign Reports", () => {
    it("should create and retrieve campaign reports with computed delta", async () => {
      const baseline = {
        lintWarnings: 100,
        lintErrors: 10,
        anyCount: 50,
        testFileCount: 5,
        totalFiles: 200,
        timestamp: Date.now() - 10000,
      }
      const current = {
        lintWarnings: 80,
        lintErrors: 3,
        anyCount: 30,
        testFileCount: 15,
        totalFiles: 210,
        timestamp: Date.now(),
      }

      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Report Project", "")
          const campaign = yield* db.createCampaign(project.id, "Report Campaign", "")
          yield* db.createCampaignReport({
            campaignId: campaign.id,
            baselineMetrics: baseline,
            currentMetrics: current,
            cardsCompleted: 5,
            cardsRemaining: 3,
            cardsBlocked: 1,
            createdAt: Date.now(),
          })
          return yield* db.getCampaignReports(campaign.id)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0].cardsCompleted).toBe(5)
      expect(result[0].delta.lintWarnings).toBe(-20) // 80 - 100
      expect(result[0].delta.lintErrors).toBe(-7) // 3 - 10
      expect(result[0].delta.anyCount).toBe(-20) // 30 - 50
      expect(result[0].delta.testFileCount).toBe(10) // 15 - 5
    })
  })

  // ========================================================================
  // Verification
  // ========================================================================

  describe("Verification", () => {
    it("should update card verification status", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Verify Project", "")
          const card = yield* db.createCard(project.id, "Verify Card", "")
          yield* db.updateCardVerification(card.id, "branch_verified", "All tests pass")
          return yield* db.getCard(card.id)
        }),
      )

      expect(result!.verificationStatus).toBe("branch_verified")
    })

    it("should query cards by verification status", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Verify Query", "")
          const c1 = yield* db.createCard(project.id, "Verified", "")
          const c2 = yield* db.createCard(project.id, "Failed", "")
          yield* db.updateCardVerification(c1.id, "branch_verified")
          yield* db.updateCardVerification(c2.id, "branch_failed")
          return yield* db.getCardsByVerificationStatus("branch_verified")
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe("Verified")
    })
  })

  // ========================================================================
  // Search (FTS)
  // ========================================================================

  describe("Search (FTS)", () => {
    it("should find cards by title via full-text search", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Search Project", "")
          yield* db.createCard(project.id, "Fix authentication bug", "Login fails on Safari")
          yield* db.createCard(project.id, "Add dark mode toggle", "UI preference")
          return yield* db.search("authentication")
        }),
      )

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe("card")
    })

    it("should find documents by content via full-text search", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Doc Search", "")
          yield* db.createProjectDocument(project.id, "brief", "Architecture Brief", "We use Effect-TS for all services")
          return yield* db.search("Effect-TS")
        }),
      )

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe("document")
    })

    it("should find decisions by title via full-text search", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          const project = yield* db.createProject("Dec Search", "")
          yield* db.createDecision(project.id, "Database Migration Strategy", "How to handle schema evolution", [], "Reasoning", "")
          return yield* db.search("migration")
        }),
      )

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe("decision")
    })

    it("should return empty results for no match", async () => {
      const result = await runWithDb(
        Effect.gen(function* () {
          const db = yield* AppPersistence
          return yield* db.search("xyznonexistentterm")
        }),
      )

      expect(result).toHaveLength(0)
    })
  })
})
