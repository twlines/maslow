import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  createMockRes,
  createMockDb,
  makeDocument,
} from "./route-test-utils.js"
import {
  handleGetDocuments,
  handleCreateDocument,
  handleGetDocument,
  handleUpdateDocument,
} from "../../routes/documents.js"

describe("document routes", () => {
  describe("GET /api/projects/:id/docs", () => {
    it("returns empty array when no documents", async () => {
      const res = createMockRes()
      const db = createMockDb()
      handleGetDocuments({ db }, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: [] })
    })

    it("returns list of documents", async () => {
      const docs = [
        makeDocument({ id: "d1", title: "Brief" }),
        makeDocument({ id: "d2", title: "Instructions", type: "instructions" }),
      ]
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocuments: () => Effect.succeed(docs),
      })
      handleGetDocuments({ db }, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: docs })
    })

    it("passes projectId to service", async () => {
      let capturedPid = ""
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocuments: (pid) => {
          capturedPid = pid
          return Effect.succeed([])
        },
      })
      handleGetDocuments({ db }, res, "proj-42")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(capturedPid).toBe("proj-42")
    })

    it("returns 500 when db fails", async () => {
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocuments: () => Effect.fail(new Error("db error")),
      })
      handleGetDocuments({ db }, res, "proj-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })

  describe("POST /api/projects/:id/docs", () => {
    it("creates a document", async () => {
      const doc = makeDocument({ id: "new-doc", title: "New Brief", type: "brief" })
      const res = createMockRes()
      const db = createMockDb({
        createProjectDocument: (_pid, type, title, content) =>
          Effect.succeed(makeDocument({ id: "new-doc", type, title, content })),
      })
      handleCreateDocument({ db }, res, "proj-1", {
        type: "brief",
        title: "New Brief",
        content: "Some content",
      })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(201)
      expect(res._mock.body).toEqual({
        ok: true,
        data: { ...doc, content: "Some content" },
      })
    })

    it("defaults content to empty string", async () => {
      let capturedContent = ""
      const res = createMockRes()
      const db = createMockDb({
        createProjectDocument: (_pid, _type, _title, content) => {
          capturedContent = content
          return Effect.succeed(makeDocument())
        },
      })
      handleCreateDocument({ db }, res, "proj-1", {
        type: "brief",
        title: "Title",
      })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(capturedContent).toBe("")
    })

    it("returns 400 when type is missing", () => {
      const res = createMockRes()
      const db = createMockDb()
      handleCreateDocument({ db }, res, "proj-1", { title: "Title" })
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "type and title are required" })
    })

    it("returns 400 when title is missing", () => {
      const res = createMockRes()
      const db = createMockDb()
      handleCreateDocument({ db }, res, "proj-1", { type: "brief" })
      expect(res._mock.status).toBe(400)
      expect(res._mock.body).toEqual({ ok: false, error: "type and title are required" })
    })

    it("returns 400 when both type and title are missing", () => {
      const res = createMockRes()
      const db = createMockDb()
      handleCreateDocument({ db }, res, "proj-1", {})
      expect(res._mock.status).toBe(400)
    })
  })

  describe("GET /api/projects/:id/docs/:docId", () => {
    it("returns a document by id", async () => {
      const doc = makeDocument({ id: "doc-42" })
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocument: (id) => Effect.succeed(id === "doc-42" ? doc : null),
      })
      handleGetDocument({ db }, res, "doc-42")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(res._mock.body).toEqual({ ok: true, data: doc })
    })

    it("returns 404 when document not found", async () => {
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocument: () => Effect.succeed(null),
      })
      handleGetDocument({ db }, res, "nonexistent")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(404)
      expect(res._mock.body).toEqual({ ok: false, error: "Document not found" })
    })

    it("returns 500 when db fails", async () => {
      const res = createMockRes()
      const db = createMockDb({
        getProjectDocument: () => Effect.fail(new Error("db error")),
      })
      handleGetDocument({ db }, res, "doc-1")
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })

  describe("PUT /api/projects/:id/docs/:docId", () => {
    it("updates a document", async () => {
      let capturedId = ""
      let capturedUpdates: Record<string, unknown> = {}
      const res = createMockRes()
      const db = createMockDb({
        updateProjectDocument: (id, updates) => {
          capturedId = id
          capturedUpdates = updates as Record<string, unknown>
          return Effect.succeed(undefined)
        },
      })
      handleUpdateDocument({ db }, res, "doc-1", { title: "Updated Title", content: "Updated content" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(200)
      expect(capturedId).toBe("doc-1")
      expect(capturedUpdates).toEqual({ title: "Updated Title", content: "Updated content" })
      expect(res._mock.body).toEqual({
        ok: true,
        data: { id: "doc-1", title: "Updated Title", content: "Updated content" },
      })
    })

    it("returns 500 when update fails", async () => {
      const res = createMockRes()
      const db = createMockDb({
        updateProjectDocument: () => Effect.fail(new Error("db error")),
      })
      handleUpdateDocument({ db }, res, "doc-1", { title: "Updated" })
      await vi.waitFor(() => expect(res._mock.ended).toBe(true))
      expect(res._mock.status).toBe(500)
      expect(res._mock.body).toEqual({ ok: false, error: "Internal server error" })
    })
  })
})
