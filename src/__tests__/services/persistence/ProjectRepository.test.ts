/**
 * Tests for AppPersistence project, project document, and decision operations.
 *
 * Covers: CRUD for projects, project documents, and decisions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { AppPersistence } from "../../../services/AppPersistence.js"
import {
  createTempDir,
  cleanupTempDir,
  runWithAppPersistence,
} from "./test-helpers.js"

describe("ProjectRepository", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  const run = <A>(effect: Effect.Effect<A, unknown, AppPersistence>) =>
    runWithAppPersistence(effect, tempDir)

  describe("Projects", () => {
    describe("createProject", () => {
      it("should create a project with active status", async () => {
        const project = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            return yield* svc.createProject("Test Project", "A test project")
          })
        )

        expect(project.id).toBeTruthy()
        expect(project.name).toBe("Test Project")
        expect(project.description).toBe("A test project")
        expect(project.status).toBe("active")
        expect(project.createdAt).toBeTypeOf("number")
        expect(project.updatedAt).toBeTypeOf("number")
      })
    })

    describe("getProject", () => {
      it("should retrieve a project by id", async () => {
        const project = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            const created = yield* svc.createProject("Find Me", "Description")
            return yield* svc.getProject(created.id)
          })
        )

        expect(project).not.toBeNull()
        expect(project!.name).toBe("Find Me")
      })

      it("should return null for non-existent project", async () => {
        const project = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            return yield* svc.getProject("nonexistent")
          })
        )

        expect(project).toBeNull()
      })
    })

    describe("getProjects", () => {
      it("should return all projects ordered by updated_at DESC", async () => {
        const projects = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            const a = yield* svc.createProject("Project A", "First")
            yield* svc.createProject("Project B", "Second")
            // Update A so it has a more recent updated_at
            yield* svc.updateProject(a.id, { description: "Updated" })
            return yield* svc.getProjects()
          })
        )

        expect(projects).toHaveLength(2)
        // A was updated most recently so should come first
        expect(projects[0].name).toBe("Project A")
      })

      it("should return empty array when no projects exist", async () => {
        const projects = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            return yield* svc.getProjects()
          })
        )

        expect(projects).toEqual([])
      })
    })

    describe("updateProject", () => {
      it("should update project fields", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            const p = yield* svc.createProject("Original", "Old desc")
            yield* svc.updateProject(p.id, {
              name: "Updated",
              description: "New desc",
              status: "paused",
              color: "#ff0000",
            })
            return yield* svc.getProject(p.id)
          })
        )

        expect(updated!.name).toBe("Updated")
        expect(updated!.description).toBe("New desc")
        expect(updated!.status).toBe("paused")
        expect(updated!.color).toBe("#ff0000")
      })

      it("should update only specified fields (COALESCE)", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            const p = yield* svc.createProject("Keep Name", "Keep Desc")
            yield* svc.updateProject(p.id, { status: "archived" })
            return yield* svc.getProject(p.id)
          })
        )

        expect(updated!.name).toBe("Keep Name")
        expect(updated!.description).toBe("Keep Desc")
        expect(updated!.status).toBe("archived")
      })

      it("should update agent config fields", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const svc = yield* AppPersistence
            const p = yield* svc.createProject("Agent Config", "")
            yield* svc.updateProject(p.id, {
              agentTimeoutMinutes: 60,
              maxConcurrentAgents: 3,
            })
            return yield* svc.getProject(p.id)
          })
        )

        expect(updated!.agentTimeoutMinutes).toBe(60)
        expect(updated!.maxConcurrentAgents).toBe(3)
      })
    })
  })

  describe("Project Documents", () => {
    const setupProject = Effect.gen(function* () {
      const svc = yield* AppPersistence
      const project = yield* svc.createProject("Doc Project", "")
      return { svc, projectId: project.id }
    })

    describe("createProjectDocument", () => {
      it("should create a document with correct type", async () => {
        const doc = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            return yield* svc.createProjectDocument(projectId, "brief", "Project Brief", "Overview content")
          })
        )

        expect(doc.id).toBeTruthy()
        expect(doc.type).toBe("brief")
        expect(doc.title).toBe("Project Brief")
        expect(doc.content).toBe("Overview content")
      })
    })

    describe("getProjectDocuments", () => {
      it("should return documents for a project", async () => {
        const docs = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            yield* svc.createProjectDocument(projectId, "brief", "Brief", "B content")
            yield* svc.createProjectDocument(projectId, "reference", "Ref", "R content")
            return yield* svc.getProjectDocuments(projectId)
          })
        )

        expect(docs).toHaveLength(2)
      })

      it("should return empty array for project with no documents", async () => {
        const docs = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            return yield* svc.getProjectDocuments(projectId)
          })
        )

        expect(docs).toEqual([])
      })
    })

    describe("getProjectDocument", () => {
      it("should retrieve a document by id", async () => {
        const doc = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const created = yield* svc.createProjectDocument(projectId, "instructions", "Setup", "How to setup")
            return yield* svc.getProjectDocument(created.id)
          })
        )

        expect(doc).not.toBeNull()
        expect(doc!.title).toBe("Setup")
      })

      it("should return null for non-existent document", async () => {
        const doc = await run(
          Effect.gen(function* () {
            const { svc } = yield* setupProject
            return yield* svc.getProjectDocument("nonexistent")
          })
        )

        expect(doc).toBeNull()
      })
    })

    describe("updateProjectDocument", () => {
      it("should update document title and content", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const doc = yield* svc.createProjectDocument(projectId, "brief", "Old Title", "Old content")
            yield* svc.updateProjectDocument(doc.id, { title: "New Title", content: "New content" })
            return yield* svc.getProjectDocument(doc.id)
          })
        )

        expect(updated!.title).toBe("New Title")
        expect(updated!.content).toBe("New content")
      })

      it("should only update specified fields", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const doc = yield* svc.createProjectDocument(projectId, "brief", "Keep Title", "Change content")
            yield* svc.updateProjectDocument(doc.id, { content: "Updated content" })
            return yield* svc.getProjectDocument(doc.id)
          })
        )

        expect(updated!.title).toBe("Keep Title")
        expect(updated!.content).toBe("Updated content")
      })
    })
  })

  describe("Decisions", () => {
    const setupProject = Effect.gen(function* () {
      const svc = yield* AppPersistence
      const project = yield* svc.createProject("Decision Project", "")
      return { svc, projectId: project.id }
    })

    describe("createDecision", () => {
      it("should create a decision with alternatives", async () => {
        const decision = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            return yield* svc.createDecision(
              projectId,
              "Database Choice",
              "Pick a database",
              ["PostgreSQL", "SQLite", "MongoDB"],
              "SQLite for simplicity",
              "Less concurrent writes"
            )
          })
        )

        expect(decision.id).toBeTruthy()
        expect(decision.title).toBe("Database Choice")
        expect(decision.alternatives).toEqual(["PostgreSQL", "SQLite", "MongoDB"])
        expect(decision.reasoning).toBe("SQLite for simplicity")
        expect(decision.tradeoffs).toBe("Less concurrent writes")
      })
    })

    describe("getDecisions", () => {
      it("should return decisions for a project", async () => {
        const decisions = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            yield* svc.createDecision(projectId, "D1", "", [], "", "")
            yield* svc.createDecision(projectId, "D2", "", [], "", "")
            return yield* svc.getDecisions(projectId)
          })
        )

        expect(decisions).toHaveLength(2)
      })

      it("should return empty array for project with no decisions", async () => {
        const decisions = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            return yield* svc.getDecisions(projectId)
          })
        )

        expect(decisions).toEqual([])
      })
    })

    describe("getDecision", () => {
      it("should retrieve a decision by id", async () => {
        const decision = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const created = yield* svc.createDecision(projectId, "Find Me", "", [], "", "")
            return yield* svc.getDecision(created.id)
          })
        )

        expect(decision).not.toBeNull()
        expect(decision!.title).toBe("Find Me")
      })

      it("should return null for non-existent decision", async () => {
        const decision = await run(
          Effect.gen(function* () {
            const { svc } = yield* setupProject
            return yield* svc.getDecision("nonexistent")
          })
        )

        expect(decision).toBeNull()
      })
    })

    describe("updateDecision", () => {
      it("should update decision fields", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const d = yield* svc.createDecision(projectId, "Original", "Old desc", ["A"], "Old reason", "Old trade")
            yield* svc.updateDecision(d.id, {
              title: "Revised",
              description: "New desc",
              alternatives: ["A", "B", "C"],
              reasoning: "New reasoning",
              tradeoffs: "New tradeoffs",
            })
            return yield* svc.getDecision(d.id)
          })
        )

        expect(updated!.title).toBe("Revised")
        expect(updated!.description).toBe("New desc")
        expect(updated!.alternatives).toEqual(["A", "B", "C"])
        expect(updated!.reasoning).toBe("New reasoning")
        expect(updated!.tradeoffs).toBe("New tradeoffs")
        expect(updated!.revisedAt).toBeTypeOf("number")
      })

      it("should only update specified fields", async () => {
        const updated = await run(
          Effect.gen(function* () {
            const { svc, projectId } = yield* setupProject
            const d = yield* svc.createDecision(projectId, "Keep", "Keep desc", ["A"], "Keep reason", "Keep trade")
            yield* svc.updateDecision(d.id, { title: "Changed" })
            return yield* svc.getDecision(d.id)
          })
        )

        expect(updated!.title).toBe("Changed")
        expect(updated!.description).toBe("Keep desc")
        expect(updated!.reasoning).toBe("Keep reason")
      })
    })
  })
})
