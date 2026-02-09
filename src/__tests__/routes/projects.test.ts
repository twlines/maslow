import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  createMockRes,
  createMockDb,
  makeProject,
} from "./route-test-utils.js"
import {
  handleGetProjects,
  handleCreateProject,
  handleGetProject,
  handleUpdateProject,
} from "../../routes/projects.js"

describe("project routes", () => {
  describe("GET /api/projects", () => {
    it("returns empty array when no projects exist", async () => {
      const res = createMockRes()
      const db = createMockDb()
      handleGetProjects({ db }, res)
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: [] })
    })

    it("returns list of projects", async () => {
      const projects = [
        makeProject({ id: "p1", name: "Alpha" }),
        makeProject({ id: "p2", name: "Beta" }),
      ]
      const res = createMockRes()
      const db = createMockDb({
        getProjects: () => Effect.succeed(projects),
      })
      handleGetProjects({ db }, res)
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: projects })
    })

    it("returns 500 when db fails", async () => {
      const res = createMockRes()
      const db = createMockDb({
        getProjects: () => Effect.fail(new Error("db error")),
      })
      handleGetProjects({ db }, res)
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })

  describe("POST /api/projects", () => {
    it("creates a project with name and description", async () => {
      const created = makeProject({ id: "new-1", name: "New Project", description: "Desc" })
      const res = createMockRes()
      const db = createMockDb({
        createProject: (name, desc) =>
          Effect.succeed(makeProject({ id: "new-1", name, description: desc })),
      })
      handleCreateProject({ db }, res, { name: "New Project", description: "Desc" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(res._mock.body).toEqual({ ok: true, data: created })
    })

    it("creates a project with empty description when not provided", async () => {
      const res = createMockRes()
      let capturedDesc = ""
      const db = createMockDb({
        createProject: (_name, desc) => {
          capturedDesc = desc
          return Effect.succeed(makeProject())
        },
      })
      handleCreateProject({ db }, res, { name: "Test" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(capturedDesc).toBe("")
    })

    it("returns 400 when name is missing", () => {
      const res = createMockRes()
      const db = createMockDb()
      handleCreateProject({ db }, res, {})
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "name is required" })
    })
  })

  describe("GET /api/projects/:id", () => {
    it("returns a project by id", async () => {
      const project = makeProject({ id: "proj-42" })
      const res = createMockRes()
      const db = createMockDb({
        getProject: (id) => Effect.succeed(id === "proj-42" ? project : null),
      })
      handleGetProject({ db }, res, "proj-42")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: project })
    })

    it("returns 404 when project not found", async () => {
      const res = createMockRes()
      const db = createMockDb({
        getProject: () => Effect.succeed(null),
      })
      handleGetProject({ db }, res, "nonexistent")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(404)
      expect(res._mock.body).toEqual({ ok: false, error: "Project not found" })
    })
  })

  describe("PUT /api/projects/:id", () => {
    it("updates a project", async () => {
      const res = createMockRes()
      let capturedId = ""
      let capturedUpdates: Record<string, unknown> = {}
      const db = createMockDb({
        updateProject: (id, updates) => {
          capturedId = id
          capturedUpdates = updates as Record<string, unknown>
          return Effect.succeed(undefined)
        },
      })
      handleUpdateProject({ db }, res, "proj-1", { name: "Updated" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(capturedId).toBe("proj-1")
      expect(capturedUpdates).toEqual({ name: "Updated" })
      expect(res._mock.body).toEqual({ ok: true, data: { id: "proj-1", name: "Updated" } })
    })

    it("returns 500 when update fails", async () => {
      const res = createMockRes()
      const db = createMockDb({
        updateProject: () => Effect.fail(new Error("db error")),
      })
      handleUpdateProject({ db }, res, "proj-1", { name: "Updated" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
    })
  })
})
