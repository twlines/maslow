/**
 * AppServer HTTP Endpoint Integration Tests
 *
 * Starts a real HTTP server with stub dependencies and makes actual
 * HTTP requests to validate endpoint behavior including:
 * - Input validation (Zod schemas, safeParseJson, clampInt)
 * - Correct response shapes
 * - Error handling for malformed input
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import http from "http"
import { AppServer, AppServerLive } from "../../services/AppServer.js"
import { AppPersistenceLive } from "../../services/AppPersistence.js"
import { MessageRepository } from "../../services/repositories/MessageRepository.js"
import { ConfigService, type AppConfig } from "../../services/Config.js"
import { KanbanLive } from "../../services/Kanban.js"
import { SteeringEngineLive } from "../../services/SteeringEngine.js"
import { Voice } from "../../services/Voice.js"
import { ClaudeSession } from "../../services/ClaudeSession.js"
import { AgentOrchestrator } from "../../services/AgentOrchestrator.js"
import { ThinkingPartner } from "../../services/ThinkingPartner.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"

const TEST_PORT = 13117
const BASE_URL = `http://localhost:${TEST_PORT}`
const AUTH_TOKEN = "test-secret-token"

// ── Temp DB ──
const dbDir = path.join(os.tmpdir(), `maslow-appserver-test-${Date.now()}`)
const dbPath = path.join(dbDir, "sessions.db")

// ── Config ──
const TestConfigLayer = Layer.succeed(ConfigService, {
  telegram: { botToken: "test", userId: 12345 },
  anthropic: { apiKey: "test" },
  workspace: { path: "/tmp/test-workspace" },
  database: { path: dbPath },
  appServer: { port: TEST_PORT, authToken: AUTH_TOKEN },
  ollama: { host: "http://localhost:11434", model: "llama3.1:8b", maxRetries: 3 },
} satisfies AppConfig)

// ── Stub layers ──
const StubMessageRepositoryLayer = Layer.succeed(MessageRepository, {
  saveMessage: () => Effect.void,
  getMessages: () => Effect.succeed([]),
})

const StubVoiceLayer = Layer.succeed(Voice, {
  transcribe: () => Effect.fail(new Error("stub")),
  synthesize: () => Effect.fail(new Error("stub")),
  isAvailable: () => Effect.succeed({ stt: false, tts: false }),
})

const StubClaudeSessionLayer = Layer.succeed(ClaudeSession, {
  sendMessage: () => Stream.empty,
  generateHandoff: () => Effect.fail(new Error("stub")),
})

const StubAgentOrchestratorLayer = Layer.succeed(AgentOrchestrator, {
  spawnAgent: () => Effect.fail(new Error("stub")),
  stopAgent: () => Effect.fail(new Error("stub")),
  getRunningAgents: () => Effect.succeed([]),
  getAgentLogs: () => Effect.succeed([]),
  shutdownAll: () => Effect.void,
})

const stubDecision = { id: "stub", projectId: "stub", title: "", description: "", alternatives: [], reasoning: "", tradeoffs: "", createdAt: 0 } as const
const stubDoc = { id: "stub", projectId: "stub", type: "assumptions" as const, title: "", content: "", createdAt: 0, updatedAt: 0 }

const StubThinkingPartnerLayer = Layer.succeed(ThinkingPartner, {
  logDecision: () => Effect.succeed(stubDecision),
  getDecisions: () => Effect.succeed([]),
  addAssumption: () => Effect.succeed(stubDoc),
  getAssumptions: () => Effect.succeed(null),
  updateStateSummary: () => Effect.void,
  getStateSummary: () => Effect.succeed(null),
  getProjectContext: () => Effect.succeed(""),
})

// ── Wire real data layers ──
const AppPersistenceLayer = AppPersistenceLive.pipe(
  Layer.provide(TestConfigLayer),
  Layer.provide(StubMessageRepositoryLayer),
)

const TestKanbanLayer = KanbanLive.pipe(Layer.provide(AppPersistenceLayer))
const TestSteeringEngineLayer = SteeringEngineLive.pipe(Layer.provide(AppPersistenceLayer))

const FullLayer = AppServerLive.pipe(
  Layer.provide(TestConfigLayer),
  Layer.provide(AppPersistenceLayer),
  Layer.provide(TestKanbanLayer),
  Layer.provide(TestSteeringEngineLayer),
  Layer.provide(StubVoiceLayer),
  Layer.provide(StubClaudeSessionLayer),
  Layer.provide(StubAgentOrchestratorLayer),
  Layer.provide(StubThinkingPartnerLayer),
)

// ── HTTP helpers ──
function req(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL)
    const r = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString()
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(raw) })
        } catch {
          resolve({ status: res.statusCode!, data: raw })
        }
      })
    })
    r.on("error", reject)
    if (body !== undefined) {
      r.write(typeof body === "string" ? body : JSON.stringify(body))
    }
    r.end()
  })
}

function reqNoAuth(method: string, urlPath: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const r = http.request({
      method,
      hostname: "localhost",
      port: TEST_PORT,
      path: urlPath,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString()
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(raw) })
        } catch {
          resolve({ status: res.statusCode!, data: raw })
        }
      })
    })
    r.on("error", reject)
    r.end()
  })
}

// ── Lifecycle ──
let runtime: ManagedRuntime.ManagedRuntime<AppServer, never>

describe("AppServer HTTP Endpoints", () => {
  beforeAll(async () => {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    runtime = ManagedRuntime.make(FullLayer)
    await runtime.runPromise(Effect.gen(function* () {
      const server = yield* AppServer
      yield* server.start()
    }))
    await new Promise((r) => setTimeout(r, 200))
  }, 15000)

  afterAll(async () => {
    await runtime.dispose()
    try {
      if (fs.existsSync(dbDir)) {
        fs.rmSync(dbDir, { recursive: true, force: true })
      }
    } catch { /* ignore */ }
  })

  // ── Health ──

  it("GET /api/health — returns health data (no auth)", async () => {
    const { status, data } = await reqNoAuth("GET", "/api/health")
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.data.status).toBe("ok")
  })

  // ── Auth ──

  it("rejects unauthenticated requests to protected routes", async () => {
    const { status } = await reqNoAuth("GET", "/api/projects")
    expect(status).toBe(401)
  })

  // ── Projects CRUD ──

  describe("Projects", () => {
    let projectId: string

    it("POST /api/projects — 201 create", async () => {
      const { status, data } = await req("POST", "/api/projects", {
        name: "Test Project",
        description: "desc",
      })
      expect(status).toBe(201)
      expect(data.ok).toBe(true)
      projectId = data.data.id
      expect(projectId).toBeTruthy()
    })

    it("GET /api/projects — 200 list", async () => {
      const { status, data } = await req("GET", "/api/projects")
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(1)
    })

    it("GET /api/projects/:id — 200 get", async () => {
      const { status, data } = await req("GET", `/api/projects/${projectId}`)
      expect(status).toBe(200)
      expect(data.data.name).toBe("Test Project")
    })

    it("PUT /api/projects/:id — 200 update", async () => {
      const { status, data } = await req("PUT", `/api/projects/${projectId}`, {
        name: "Updated",
      })
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
    })

    it("POST /api/projects — 400 invalid JSON", async () => {
      const { status, data } = await req("POST", "/api/projects", "not json{{{")
      expect(status).toBe(400)
      expect(data.ok).toBe(false)
    })

    it("POST /api/projects — 400 missing name", async () => {
      const { status, data } = await req("POST", "/api/projects", {
        description: "no name",
      })
      expect(status).toBe(400)
      expect(data.ok).toBe(false)
    })
  })

  // ── Cards CRUD (routes: /api/projects/:id/cards) ──

  describe("Cards", () => {
    let projectId: string
    let cardId: string

    beforeAll(async () => {
      const { data } = await req("POST", "/api/projects", { name: "Card Project" })
      projectId = data.data.id
    })

    it("POST /api/projects/:id/cards — 201 create", async () => {
      const { status, data } = await req("POST", `/api/projects/${projectId}/cards`, {
        title: "Test Card",
        description: "desc",
      })
      expect(status).toBe(201)
      expect(data.ok).toBe(true)
      cardId = data.data.id
    })

    it("GET /api/projects/:id/cards — 200 board", async () => {
      const { status, data } = await req("GET", `/api/projects/${projectId}/cards`)
      expect(status).toBe(200)
      expect(data.data.backlog.length).toBeGreaterThanOrEqual(1)
    })

    it("PUT /api/projects/:id/cards/:cardId — 200 update", async () => {
      const { status, data } = await req("PUT", `/api/projects/${projectId}/cards/${cardId}`, {
        title: "Updated Card",
        labels: ["bug"],
      })
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
    })

    it("PUT /api/projects/:id/cards/:cardId — 400 invalid JSON", async () => {
      const { status } = await req("PUT", `/api/projects/${projectId}/cards/${cardId}`, "broken{{")
      expect(status).toBe(400)
    })

    it("DELETE /api/projects/:id/cards/:cardId — 200 delete", async () => {
      const { data: c } = await req("POST", `/api/projects/${projectId}/cards`, { title: "Del" })
      const { status } = await req("DELETE", `/api/projects/${projectId}/cards/${c.data.id}`)
      expect(status).toBe(200)
    })
  })

  // ── Documents CRUD (routes: /api/projects/:id/docs) ──

  describe("Documents", () => {
    let projectId: string

    beforeAll(async () => {
      const { data } = await req("POST", "/api/projects", { name: "Doc Project" })
      projectId = data.data.id
    })

    it("POST /api/projects/:id/docs — 201 create", async () => {
      const { status, data } = await req("POST", `/api/projects/${projectId}/docs`, {
        type: "brief",
        title: "Project Brief",
        content: "Brief content.",
      })
      expect(status).toBe(201)
      expect(data.ok).toBe(true)
    })

    it("GET /api/projects/:id/docs — 200 list", async () => {
      const { status, data } = await req("GET", `/api/projects/${projectId}/docs`)
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(1)
    })

    it("POST /api/projects/:id/docs — 400 missing type", async () => {
      const { status, data } = await req("POST", `/api/projects/${projectId}/docs`, {
        title: "No Type",
        content: "Missing type field",
      })
      expect(status).toBe(400)
      expect(data.ok).toBe(false)
    })
  })

  // ── Decisions (routes: /api/projects/:id/decisions) ──

  describe("Decisions", () => {
    let projectId: string

    beforeAll(async () => {
      const { data } = await req("POST", "/api/projects", { name: "Decision Project" })
      projectId = data.data.id
    })

    it("POST /api/projects/:id/decisions — 201 create", async () => {
      const { status, data } = await req("POST", `/api/projects/${projectId}/decisions`, {
        title: "Use SQLite",
        description: "Embedded DB",
        alternatives: ["Postgres", "SQLite"],
        reasoning: "No network round trips",
        tradeoffs: "Limited concurrency",
      })
      expect(status).toBe(201)
      expect(data.ok).toBe(true)
    })

    it("GET /api/projects/:id/decisions — 200 list", async () => {
      const { status, data } = await req("GET", `/api/projects/${projectId}/decisions`)
      expect(status).toBe(200)
      expect(Array.isArray(data.data)).toBe(true)
    })
  })

  // ── Steering (routes: /api/steering) ──

  describe("Steering", () => {
    it("POST /api/steering — 201 create", async () => {
      const { status, data } = await req("POST", "/api/steering", {
        correction: "Always use double quotes",
        domain: "style",
        source: "explicit",
      })
      expect(status).toBe(201)
      expect(data.ok).toBe(true)
    })

    it("GET /api/steering — 200 list", async () => {
      const { status, data } = await req("GET", "/api/steering")
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(1)
    })

    it("POST /api/steering — 400 invalid domain", async () => {
      const { status } = await req("POST", "/api/steering", {
        correction: "test",
        domain: "invalid-domain",
        source: "explicit",
      })
      expect(status).toBe(400)
    })
  })
})
