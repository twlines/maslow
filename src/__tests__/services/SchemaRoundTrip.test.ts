/**
 * Schema Round-Trip Tests
 *
 * Validates that data returned by AppPersistence methods conforms to
 * the Zod schemas defined in @maslow/shared. This catches drift between
 * the SQL layer (column names, types, JSON parsing) and the contract
 * schemas used at API boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AppPersistence, AppPersistenceLive } from "../../services/AppPersistence.js"
import { MessageRepository } from "../../services/repositories/MessageRepository.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import {
  ProjectSchema,
  KanbanCardSchema,
  ProjectDocumentSchema,
  DecisionSchema,
  ConversationSchema,
  SteeringCorrectionSchema,
  AuditEntrySchema,
  CampaignSchema,
  CampaignReportSchema,
  SearchResultSchema,
} from "@maslow/shared"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

const createTempDbPath = () => {
  const tmpDir = os.tmpdir()
  const dbDir = path.join(tmpDir, `maslow-schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
    // Ignore
  }
}

const createTestConfigLayer = (dbPath: string) =>
  Layer.succeed(ConfigService, {
    telegram: { botToken: "test-token", userId: 12345 },
    anthropic: { apiKey: "test-key" },
    workspace: { path: "/tmp/test-workspace" },
    database: { path: dbPath },
  } satisfies AppConfig)

const StubMessageRepositoryLayer = Layer.succeed(MessageRepository, {
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
})

describe("Schema Round-Trip Validation", () => {
  let tempDbPath: string

  beforeEach(() => {
    tempDbPath = createTempDbPath()
  })

  afterEach(() => {
    cleanupTempDir(tempDbPath)
  })

  const runWithDb = <A>(
    effect: Effect.Effect<A, unknown, AppPersistence>,
  ): Promise<A> => {
    const configLayer = createTestConfigLayer(tempDbPath)
    const testLayer = AppPersistenceLive.pipe(
      Layer.provide(configLayer),
      Layer.provide(StubMessageRepositoryLayer),
    )
    return Effect.runPromise(
      Effect.scoped(Effect.provide(effect, testLayer)),
    )
  }

  it("ProjectSchema validates createProject output", async () => {
    const project = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        return yield* db.createProject("Schema Test", "desc")
      }),
    )

    const result = ProjectSchema.safeParse(project)
    expect(result.success).toBe(true)
  })

  it("ProjectSchema validates getProject output", async () => {
    const project = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Schema Test", "desc")
        return yield* db.getProject(p.id)
      }),
    )

    const result = ProjectSchema.safeParse(project)
    expect(result.success).toBe(true)
  })

  it("KanbanCardSchema validates createCard output", async () => {
    const card = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Card Schema", "")
        return yield* db.createCard(p.id, "Test Card", "desc")
      }),
    )

    const result = KanbanCardSchema.safeParse(card)
    if (!result.success) {
      console.error("KanbanCard validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("KanbanCardSchema validates getCard output after agent assignment", async () => {
    const card = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Agent Card", "")
        const c = yield* db.createCard(p.id, "Agent Test", "")
        yield* db.assignCardAgent(c.id, "ollama")
        yield* db.startCard(c.id)
        return yield* db.getCard(c.id)
      }),
    )

    const result = KanbanCardSchema.safeParse(card)
    if (!result.success) {
      console.error("KanbanCard (agent) validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("KanbanCardSchema validates completed card", async () => {
    const card = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Complete Card", "")
        const c = yield* db.createCard(p.id, "Complete Test", "")
        yield* db.startCard(c.id)
        yield* db.completeCard(c.id)
        return yield* db.getCard(c.id)
      }),
    )

    const result = KanbanCardSchema.safeParse(card)
    if (!result.success) {
      console.error("KanbanCard (completed) validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("ProjectDocumentSchema validates createProjectDocument output", async () => {
    const doc = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Doc Schema", "")
        return yield* db.createProjectDocument(p.id, "brief", "My Brief", "Content")
      }),
    )

    const result = ProjectDocumentSchema.safeParse(doc)
    expect(result.success).toBe(true)
  })

  it("DecisionSchema validates createDecision output", async () => {
    const decision = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Dec Schema", "")
        return yield* db.createDecision(
          p.id, "Use Ollama", "desc", ["A", "B"], "reasoning", "tradeoffs",
        )
      }),
    )

    const result = DecisionSchema.safeParse(decision)
    expect(result.success).toBe(true)
  })

  it("DecisionSchema validates getDecision output (with revisedAt)", async () => {
    const decision = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Dec Revised", "")
        const d = yield* db.createDecision(p.id, "Old", "desc", [], "", "")
        yield* db.updateDecision(d.id, { title: "Revised" })
        return yield* db.getDecision(d.id)
      }),
    )

    const result = DecisionSchema.safeParse(decision)
    expect(result.success).toBe(true)
  })

  it("ConversationSchema validates createConversation output", async () => {
    const conv = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        return yield* db.createConversation(null)
      }),
    )

    const result = ConversationSchema.safeParse(conv)
    if (!result.success) {
      console.error("Conversation validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("SteeringCorrectionSchema validates addCorrection output", async () => {
    const correction = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        return yield* db.addCorrection("Always use double quotes", "style", "explicit", "Review feedback")
      }),
    )

    const result = SteeringCorrectionSchema.safeParse(correction)
    expect(result.success).toBe(true)
  })

  it("AuditEntrySchema validates audit log entries", async () => {
    const entries = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        yield* db.logAudit("card", "card-1", "created", { title: "Test" }, "user")
        const log = yield* db.getAuditLog({})
        return log.items
      }),
    )

    expect(entries.length).toBeGreaterThanOrEqual(1)
    const result = AuditEntrySchema.safeParse(entries[0])
    if (!result.success) {
      console.error("AuditEntry validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("CampaignSchema validates createCampaign output", async () => {
    const campaign = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Campaign Schema", "")
        return yield* db.createCampaign(p.id, "Lint Fix", "Fix all lint errors")
      }),
    )

    const result = CampaignSchema.safeParse(campaign)
    if (!result.success) {
      console.error("Campaign validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("CampaignReportSchema validates report with delta", async () => {
    const reports = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Report Schema", "")
        const c = yield* db.createCampaign(p.id, "Report Campaign", "")
        const now = Date.now()
        yield* db.createCampaignReport({
          campaignId: c.id,
          baselineMetrics: { lintWarnings: 10, lintErrors: 5, anyCount: 3, testFileCount: 2, totalFiles: 50, timestamp: now - 1000 },
          currentMetrics: { lintWarnings: 5, lintErrors: 2, anyCount: 1, testFileCount: 5, totalFiles: 55, timestamp: now },
          cardsCompleted: 3,
          cardsRemaining: 2,
          cardsBlocked: 0,
          createdAt: now,
        })
        return yield* db.getCampaignReports(c.id)
      }),
    )

    expect(reports.length).toBe(1)
    const result = CampaignReportSchema.safeParse(reports[0])
    if (!result.success) {
      console.error("CampaignReport validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })

  it("SearchResultSchema validates FTS search results", async () => {
    const results = await runWithDb(
      Effect.gen(function* () {
        const db = yield* AppPersistence
        const p = yield* db.createProject("Search Schema", "")
        yield* db.createCard(p.id, "Authentication fix for Safari", "Fix login flow")
        return yield* db.search("authentication")
      }),
    )

    expect(results.length).toBeGreaterThanOrEqual(1)
    const result = SearchResultSchema.safeParse(results[0])
    if (!result.success) {
      console.error("SearchResult validation errors:", result.error.issues)
    }
    expect(result.success).toBe(true)
  })
})
