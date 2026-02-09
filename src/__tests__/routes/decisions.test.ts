import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  createMockRes,
  createMockThinkingPartner,
  makeDecision,
} from "./route-test-utils.js"
import {
  handleGetDecisions,
  handleCreateDecision,
  handleGetProjectContext,
} from "../../routes/decisions.js"

describe("decision routes", () => {
  describe("GET /api/projects/:id/decisions", () => {
    it("returns empty array when no decisions", async () => {
      const res = createMockRes()
      const deps = { thinkingPartner: createMockThinkingPartner() }
      handleGetDecisions(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: [] })
    })

    it("returns list of decisions", async () => {
      const decisions = [
        makeDecision({ id: "d1", title: "Use Effect-TS" }),
        makeDecision({ id: "d2", title: "Use SQLite" }),
      ]
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          getDecisions: () => Effect.succeed(decisions),
        }),
      }
      handleGetDecisions(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: decisions })
    })

    it("passes projectId to service", async () => {
      let capturedProjectId = ""
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          getDecisions: (pid) => {
            capturedProjectId = pid
            return Effect.succeed([])
          },
        }),
      }
      handleGetDecisions(deps, res, "proj-42")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(capturedProjectId).toBe("proj-42")
    })

    it("returns 500 when service fails", async () => {
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          getDecisions: () => Effect.fail(new Error("service error")),
        }),
      }
      handleGetDecisions(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })

  describe("POST /api/projects/:id/decisions", () => {
    it("creates a decision with all fields", async () => {
      const decision = makeDecision({
        id: "new-dec",
        title: "Use REST",
        description: "REST over GraphQL",
        alternatives: ["GraphQL", "gRPC"],
        reasoning: "Simpler",
        tradeoffs: "Less flexible queries",
      })
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          logDecision: (_pid, body) =>
            Effect.succeed(makeDecision({
              id: "new-dec",
              title: body.title,
              description: body.description,
              alternatives: body.alternatives,
              reasoning: body.reasoning,
              tradeoffs: body.tradeoffs,
            })),
        }),
      }
      handleCreateDecision(deps, res, "proj-1", {
        title: "Use REST",
        description: "REST over GraphQL",
        alternatives: ["GraphQL", "gRPC"],
        reasoning: "Simpler",
        tradeoffs: "Less flexible queries",
      })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(res._mock.body).toEqual({ ok: true, data: decision })
    })

    it("defaults optional fields to empty values", async () => {
      let capturedBody: Record<string, unknown> = {}
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          logDecision: (_pid, body) => {
            capturedBody = body
            return Effect.succeed(makeDecision())
          },
        }),
      }
      handleCreateDecision(deps, res, "proj-1", { title: "Minimal" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(capturedBody).toEqual({
        title: "Minimal",
        description: "",
        alternatives: [],
        reasoning: "",
        tradeoffs: "",
      })
    })

    it("returns 400 when title is missing", () => {
      const res = createMockRes()
      const deps = { thinkingPartner: createMockThinkingPartner() }
      handleCreateDecision(deps, res, "proj-1", {})
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "title is required" })
    })
  })

  describe("GET /api/projects/:id/context", () => {
    it("returns project context string", async () => {
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          getProjectContext: () => Effect.succeed("Project context summary"),
        }),
      }
      handleGetProjectContext(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({
        ok: true,
        data: { context: "Project context summary" },
      })
    })

    it("returns empty context when none exists", async () => {
      const res = createMockRes()
      const deps = { thinkingPartner: createMockThinkingPartner() }
      handleGetProjectContext(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: { context: "" } })
    })

    it("returns 500 when service fails", async () => {
      const res = createMockRes()
      const deps = {
        thinkingPartner: createMockThinkingPartner({
          getProjectContext: () => Effect.fail(new Error("failed")),
        }),
      }
      handleGetProjectContext(deps, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })
})
