/**
 * Project Repository
 *
 * Extracted from AppPersistence — handles CRUD for the projects table.
 */

import { Effect } from "effect"
import { randomUUID } from "crypto"
import type Database from "better-sqlite3"

export interface AppProject {
  id: string
  name: string
  description: string
  status: "active" | "archived" | "paused"
  createdAt: number
  updatedAt: number
  color?: string
  agentTimeoutMinutes?: number
  maxConcurrentAgents?: number
}

export type ProjectUpdates = Partial<Pick<AppProject, "name" | "description" | "status" | "color" | "agentTimeoutMinutes" | "maxConcurrentAgents">>

export interface ProjectRepositoryService {
  getProjects(): Effect.Effect<AppProject[]>
  getProject(id: string): Effect.Effect<AppProject | null>
  createProject(name: string, description: string): Effect.Effect<AppProject>
  updateProject(id: string, updates: ProjectUpdates): Effect.Effect<void>
}

export function createProjectRepository(db: Database.Database): ProjectRepositoryService {
  const stmts = {
    getProjects: db.prepare(`
      SELECT * FROM projects ORDER BY updated_at DESC
    `),
    getProject: db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `),
    createProject: db.prepare(`
      INSERT INTO projects (id, name, description, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `),
    updateProject: db.prepare(`
      UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
      status = COALESCE(?, status), color = COALESCE(?, color),
      agent_timeout_minutes = COALESCE(?, agent_timeout_minutes),
      max_concurrent_agents = COALESCE(?, max_concurrent_agents),
      updated_at = ?
      WHERE id = ?
    `),
  }

  const mapRow = (r: Record<string, unknown>): AppProject => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    status: r.status as AppProject["status"],
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    color: (r.color as string) || undefined,
    agentTimeoutMinutes: (r.agent_timeout_minutes as number) ?? undefined,
    maxConcurrentAgents: (r.max_concurrent_agents as number) ?? undefined,
  })

  return {
    getProjects: () =>
      Effect.sync(() => {
        const rows = stmts.getProjects.all() as Record<string, unknown>[]
        return rows.map(mapRow)
      }),

    getProject: (id) =>
      Effect.sync(() => {
        const r = stmts.getProject.get(id) as Record<string, unknown> | undefined
        if (!r) return null
        return mapRow(r)
      }),

    createProject: (name, description) =>
      Effect.sync(() => {
        const id = randomUUID()
        const now = Date.now()
        stmts.createProject.run(id, name, description, now, now)
        return {
          id,
          name,
          description,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        }
      }),

    updateProject: (id, updates) =>
      Effect.sync(() => {
        stmts.updateProject.run(
          updates.name ?? null,
          updates.description ?? null,
          updates.status ?? null,
          updates.color ?? null,
          updates.agentTimeoutMinutes ?? null,
          updates.maxConcurrentAgents ?? null,
          Date.now(),
          id
        )
      }),
  }
}
