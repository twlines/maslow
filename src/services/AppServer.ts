/**
 * App Server Service
 *
 * HTTP/WS API server for the Maslow web and mobile apps.
 * Runs alongside the Telegram bot on a separate port.
 */

import { Context, Effect, Layer, Stream } from "effect";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Duplex } from "stream";
import { createServer as createHttpsServer } from "https";
import * as fs from "fs";
import { readFileSync } from "fs";
import * as nodePath from "path";
import { ConfigService } from "./Config.js";
import { ClaudeSession } from "./ClaudeSession.js";
import { AppPersistence, type AppConversation, type AuditLogFilters } from "./AppPersistence.js";
import { Voice } from "./Voice.js";
import { Kanban } from "./Kanban.js";
import { ThinkingPartner } from "./ThinkingPartner.js";
import { AgentOrchestrator, setAgentBroadcast } from "./AgentOrchestrator.js";
import { setHeartbeatBroadcast } from "./Heartbeat.js";
import { SteeringEngine } from "./SteeringEngine.js";
import type { CorrectionDomain, CorrectionSource } from "./AppPersistence.js";
import { createRouter, sendJson, readBody, readBodyRaw, type Route } from "./server/router.js";
import { authenticate, handleAuthToken, handleAuthRefresh, AUTH_TOKEN_HEADER } from "./server/auth.js";

// Tech keywords for cross-project pattern matching
const TECH_KEYWORDS = [
  "typescript", "react", "effect", "sqlite", "websocket", "rest", "api",
  "encryption", "auth", "jwt", "oauth", "expo", "node", "claude", "llm",
  "voice", "tts", "stt", "kanban", "crud", "database", "migration",
  "testing", "vitest", "eslint", "docker", "ci", "cd", "deploy",
  "crypto", "x25519", "aes", "gcm", "biometric", "faceid", "push",
  "notification", "streaming", "pipecat", "whisper", "chatterbox",
  "nextjs", "vercel", "tailwind", "prisma", "postgres", "redis",
];

function extractTechKeywords(text: string): string[] {
  return TECH_KEYWORDS.filter(kw => text.includes(kw));
}

// Workspace actions system prompt — injected into project-scoped conversations
// so Claude can create cards, log decisions, and track assumptions from conversation
const WORKSPACE_ACTIONS_PROMPT = `
You have workspace actions available. When appropriate during conversation, emit action blocks to manage the project workspace. Use these naturally — when you notice a task to track, a decision being made, or an assumption being stated.

Available actions (emit as JSON blocks wrapped in :::action and ::: delimiters):

1. Create a kanban card:
:::action
{"type":"create_card","title":"Card title","description":"Optional description","column":"backlog"}
:::

2. Move a card (columns: backlog, in_progress, done):
:::action
{"type":"move_card","title":"Card title to find","column":"done"}
:::

3. Log a decision:
:::action
{"type":"log_decision","title":"Decision title","description":"What was decided","alternatives":["Option A","Option B"],"reasoning":"Why this path","tradeoffs":"What we give up"}
:::

4. Track an assumption:
:::action
{"type":"add_assumption","assumption":"What we're assuming but haven't validated"}
:::

5. Update project state summary:
:::action
{"type":"update_state","summary":"Current state: what's done, in progress, blocked, next"}
:::

Rules:
- Only emit actions when they naturally arise from conversation
- Don't announce actions — just do them. The user sees the result in their workspace
- Multiple actions per response are fine
- For move_card, match by title substring (case-insensitive)
- Prefer backlog for new ideas, in_progress for active work, done for completed items
`.trim();

export interface WorkspaceAction {
  type: "create_card" | "move_card" | "log_decision" | "add_assumption" | "update_state"
  title?: string
  description?: string
  column?: string
  alternatives?: string[]
  reasoning?: string
  tradeoffs?: string
  assumption?: string
  summary?: string
}

const VALID_ACTION_TYPES: ReadonlySet<WorkspaceAction["type"]> = new Set([
  "create_card",
  "move_card",
  "log_decision",
  "add_assumption",
  "update_state",
])

/**
 * Parse :::action {json} ::: blocks from Claude text output.
 * Pure function — no side effects. Skips malformed or invalid blocks.
 */
export function parseWorkspaceActions(text: string): WorkspaceAction[] {
  const actions: WorkspaceAction[] = []
  const regex = /:::action\s*\n([\s\S]*?)\n:::/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim())
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        typeof (parsed as Record<string, unknown>).type === "string" &&
        VALID_ACTION_TYPES.has((parsed as Record<string, unknown>).type as WorkspaceAction["type"])
      ) {
        actions.push(parsed as WorkspaceAction)
      }
    } catch {
      // Skip malformed JSON blocks
    }
  }
  return actions
}

export interface AppServerService {
  start(): Effect.Effect<void, Error>;
  stop(): Effect.Effect<void>;
}

export class AppServer extends Context.Tag("AppServer")<
  AppServer,
  AppServerService
>() {}

export const AppServerLive = Layer.scoped(
  AppServer,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const claude = yield* ClaudeSession;
    const db = yield* AppPersistence;
    const voice = yield* Voice;
    const kanban = yield* Kanban;
    const thinkingPartner = yield* ThinkingPartner;
    const agentOrchestrator = yield* AgentOrchestrator;
    const steeringEngine = yield* SteeringEngine;

    const port = config.appServer?.port ?? 3117;
    const authToken = config.appServer?.authToken ?? "";
    const tlsCertPath = config.appServer?.tlsCertPath;
    const tlsKeyPath = config.appServer?.tlsKeyPath;
    const useTls = !!(tlsCertPath && tlsKeyPath);

    let httpServer: ReturnType<typeof createServer> | ReturnType<typeof createHttpsServer> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wss: any = null;
    const clients = new Set<any>() // WebSocket instances tracked explicitly

    // Broadcast a JSON-serializable message to all connected WebSocket clients
    const broadcast = (message: unknown): void => {
      const data = JSON.stringify(message)
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(data)
        }
      }
    }

    const baseUrl = `http://localhost:${port}`;

    // ── Route table ──
    // Declarative route definitions replace sequential if/regex matching.
    // Auth-exempt routes (health, auth/token) are listed first.
    // All other routes require authentication (enforced in handleRequest).

    const routes: Route[] = [
      // ── Auth-exempt routes (handled before auth check) ──

      // Health check (no auth — used by load balancers/monitoring)
      {
        method: "GET",
        pattern: "/api/health",
        handler: async (_req, res) => {
          const agents = await Effect.runPromise(agentOrchestrator.getRunningAgents())
          const runningCount = agents.filter((a) => a.status === "running").length
          sendJson(res, 200, {
            ok: true,
            data: {
              status: "ok",
              uptime: process.uptime(),
              timestamp: Date.now(),
              heartbeat: {
                intervalMs: 30_000,
                connectedClients: wss?.clients?.size ?? 0,
              },
              agents: {
                running: runningCount,
                total: agents.length,
              },
            },
          })
        },
      },

      // Auth — exchange raw secret for JWT (no auth required)
      {
        method: "POST",
        pattern: "/api/auth/token",
        handler: async (req, res) => {
          await handleAuthToken(req, res, authToken)
        },
      },

      // Auth — refresh a valid JWT for a new one
      {
        method: "POST",
        pattern: "/api/auth/refresh",
        handler: async (req, res) => {
          await handleAuthRefresh(req, res, authToken, req.headers[AUTH_TOKEN_HEADER])
        },
      },

      // ── Messages ──

      {
        method: "GET",
        pattern: "/api/messages",
        handler: async (_req, res, { searchParams }) => {
          const projectId = searchParams.get("projectId") || null
          const limit = parseInt(searchParams.get("limit") || "50")
          const offset = parseInt(searchParams.get("offset") || "0")
          const messages = await Effect.runPromise(db.getMessages(projectId, limit, offset))
          sendJson(res, 200, { ok: true, data: messages })
        },
      },

      // ── Projects ──

      {
        method: "GET",
        pattern: "/api/projects",
        handler: async (_req, res) => {
          const projects = await Effect.runPromise(db.getProjects())
          sendJson(res, 200, { ok: true, data: projects })
        },
      },
      {
        method: "POST",
        pattern: "/api/projects",
        handler: async (req, res) => {
          const body = JSON.parse(await readBody(req))
          const project = await Effect.runPromise(db.createProject(body.name, body.description || ""))
          sendJson(res, 201, { ok: true, data: project })
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const project = await Effect.runPromise(db.getProject(params.projectId))
          if (!project) {
            sendJson(res, 404, { ok: false, error: "Project not found" })
            return
          }
          sendJson(res, 200, { ok: true, data: project })
        },
      },
      {
        method: "PUT",
        pattern: /^\/api\/projects\/([^/]+)$/,
        paramNames: ["projectId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          await Effect.runPromise(db.updateProject(params.projectId, body))
          sendJson(res, 200, { ok: true, data: { id: params.projectId, ...body } })
        },
      },

      // ── Project messages ──

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/messages$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params, searchParams }) => {
          const limit = parseInt(searchParams.get("limit") || "50")
          const offset = parseInt(searchParams.get("offset") || "0")
          const messages = await Effect.runPromise(db.getMessages(params.projectId, limit, offset))
          sendJson(res, 200, { ok: true, data: messages })
        },
      },

      // ── Project documents ──

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/docs$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const docs = await Effect.runPromise(db.getProjectDocuments(params.projectId))
          sendJson(res, 200, { ok: true, data: docs })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/docs$/,
        paramNames: ["projectId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          const doc = await Effect.runPromise(db.createProjectDocument(params.projectId, body.type, body.title, body.content))
          sendJson(res, 201, { ok: true, data: doc })
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/docs\/([^/]+)$/,
        paramNames: ["projectId", "docId"],
        handler: async (_req, res, { params }) => {
          const doc = await Effect.runPromise(db.getProjectDocument(params.docId))
          if (!doc) {
            sendJson(res, 404, { ok: false, error: "Document not found" })
            return
          }
          sendJson(res, 200, { ok: true, data: doc })
        },
      },
      {
        method: "PUT",
        pattern: /^\/api\/projects\/([^/]+)\/docs\/([^/]+)$/,
        paramNames: ["projectId", "docId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          await Effect.runPromise(db.updateProjectDocument(params.docId, body))
          sendJson(res, 200, { ok: true, data: { id: params.docId, ...body } })
        },
      },

      // ── Kanban cards ──
      // Note: /cards/next must come BEFORE /cards/:cardId to avoid "next" being captured as a cardId

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/next$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const card = await Effect.runPromise(kanban.getNext(params.projectId))
          sendJson(res, 200, { ok: true, data: card })
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/cards$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const board = await Effect.runPromise(kanban.getBoard(params.projectId))
          sendJson(res, 200, { ok: true, data: board })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards$/,
        paramNames: ["projectId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          const card = await Effect.runPromise(kanban.createCard(params.projectId, body.title, body.description, body.column))
          sendJson(res, 201, { ok: true, data: card })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/context$/,
        paramNames: ["projectId", "cardId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          await Effect.runPromise(kanban.saveContext(params.cardId, body.snapshot, body.sessionId))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/skip$/,
        paramNames: ["projectId", "cardId"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(kanban.skipToBack(params.cardId))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/assign$/,
        paramNames: ["projectId", "cardId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          await Effect.runPromise(kanban.assignAgent(params.cardId, body.agent))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/start$/,
        paramNames: ["projectId", "cardId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          await Effect.runPromise(kanban.startWork(params.cardId, body.agent))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/complete$/,
        paramNames: ["projectId", "cardId"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(kanban.completeWork(params.cardId))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/resume$/,
        paramNames: ["projectId", "cardId"],
        handler: async (_req, res, { params }) => {
          const result = await Effect.runPromise(kanban.resume(params.cardId))
          sendJson(res, 200, { ok: true, data: result })
        },
      },
      {
        method: "PUT",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)$/,
        paramNames: ["projectId", "cardId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          if (body.if_updated_at !== undefined) {
            const current = await Effect.runPromise(db.getCard(params.cardId))
            if (!current) {
              sendJson(res, 404, { ok: false, error: "Card not found" })
              return
            }
            if (current.updatedAt !== body.if_updated_at) {
              sendJson(res, 409, {
                ok: false,
                error: "Card was modified by another client",
                currentUpdatedAt: current.updatedAt,
              })
              return
            }
          }
          if (body.column !== undefined) {
            await Effect.runPromise(kanban.moveCard(params.cardId, body.column))
          }
          await Effect.runPromise(kanban.updateCard(params.cardId, body))
          sendJson(res, 200, { ok: true, data: { id: params.cardId, ...body } })
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/projects\/([^/]+)\/cards\/([^/]+)$/,
        paramNames: ["projectId", "cardId"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(kanban.deleteCard(params.cardId))
          sendJson(res, 200, { ok: true, data: { deleted: true } })
        },
      },

      // ── Decisions ──

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/decisions$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const decisions = await Effect.runPromise(thinkingPartner.getDecisions(params.projectId))
          sendJson(res, 200, { ok: true, data: decisions })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/projects\/([^/]+)\/decisions$/,
        paramNames: ["projectId"],
        handler: async (req, res, { params }) => {
          const body = JSON.parse(await readBody(req))
          const decision = await Effect.runPromise(thinkingPartner.logDecision(params.projectId, body))
          sendJson(res, 201, { ok: true, data: decision })
        },
      },

      // ── Project context ──

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/context$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const context = await Effect.runPromise(thinkingPartner.getProjectContext(params.projectId))
          sendJson(res, 200, { ok: true, data: { context } })
        },
      },

      // ── Project export ──

      {
        method: "GET",
        pattern: /^\/api\/projects\/([^/]+)\/export$/,
        paramNames: ["projectId"],
        handler: async (_req, res, { params }) => {
          const projectId = params.projectId
          const project = await Effect.runPromise(db.getProject(projectId))
          if (!project) {
            sendJson(res, 404, { ok: false, error: "Project not found" })
            return
          }

          const board = await Effect.runPromise(kanban.getBoard(projectId))
          const decisions = await Effect.runPromise(thinkingPartner.getDecisions(projectId))
          const docs = await Effect.runPromise(db.getProjectDocuments(projectId))
          const conversations = await Effect.runPromise(db.getRecentConversations(projectId, 10))

          const lines: string[] = []

          lines.push(`# ${project.name}`)
          if (project.description) {
            lines.push("", project.description)
          }
          lines.push("")

          lines.push("## Kanban Board", "")
          lines.push("### Backlog")
          if (board.backlog.length > 0) {
            for (const card of board.backlog) {
              lines.push(`- ${card.title}${card.description ? ` — ${card.description}` : ""}`)
            }
          } else {
            lines.push("_No items_")
          }
          lines.push("")

          lines.push("### In Progress")
          if (board.in_progress.length > 0) {
            for (const card of board.in_progress) {
              lines.push(`- ${card.title}${card.description ? ` — ${card.description}` : ""}`)
            }
          } else {
            lines.push("_No items_")
          }
          lines.push("")

          lines.push("### Done")
          if (board.done.length > 0) {
            for (const card of board.done) {
              lines.push(`- ${card.title}${card.description ? ` — ${card.description}` : ""}`)
            }
          } else {
            lines.push("_No items_")
          }
          lines.push("")

          lines.push("## Decisions", "")
          if (decisions.length > 0) {
            for (const decision of decisions) {
              lines.push(`### ${decision.title}`)
              if (decision.description) {
                lines.push("", decision.description)
              }
              if (decision.reasoning) {
                lines.push("", `**Reasoning:** ${decision.reasoning}`)
              }
              if (decision.alternatives.length > 0) {
                lines.push("", "**Alternatives considered:**")
                for (const alt of decision.alternatives) {
                  lines.push(`- ${alt}`)
                }
              }
              if (decision.tradeoffs) {
                lines.push("", `**Tradeoffs:** ${decision.tradeoffs}`)
              }
              lines.push("")
            }
          } else {
            lines.push("_No decisions recorded_", "")
          }

          lines.push("## Documents", "")
          if (docs.length > 0) {
            for (const doc of docs) {
              lines.push(`### ${doc.title}`, "")
              if (doc.content) {
                lines.push(doc.content)
              }
              lines.push("")
            }
          } else {
            lines.push("_No documents_", "")
          }

          lines.push("## Recent Conversations", "")
          if (conversations.length > 0) {
            for (const conv of conversations) {
              const date = new Date(conv.lastMessageAt).toISOString().split("T")[0]
              lines.push(`- **${date}** — ${conv.messageCount} messages (${conv.status})${conv.summary ? `: ${conv.summary.slice(0, 200)}` : ""}`)
            }
          } else {
            lines.push("_No conversations_")
          }
          lines.push("")

          const markdown = lines.join("\n")
          const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_export.md`
          res.writeHead(200, {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          })
          res.end(markdown)
        },
      },

      // ── Conversations ──

      {
        method: "GET",
        pattern: "/api/conversations",
        handler: async (_req, res, { searchParams }) => {
          const projectId = searchParams.get("projectId") || null
          const limit = parseInt(searchParams.get("limit") || "20")
          const conversations = await Effect.runPromise(db.getRecentConversations(projectId, limit))
          sendJson(res, 200, { ok: true, data: conversations })
        },
      },
      {
        method: "GET",
        pattern: "/api/conversations/active",
        handler: async (_req, res, { searchParams }) => {
          const projectId = searchParams.get("projectId") || null
          const conversation = await Effect.runPromise(db.getActiveConversation(projectId))
          sendJson(res, 200, { ok: true, data: conversation })
        },
      },

      // ── Voice ──

      {
        method: "GET",
        pattern: "/api/voice/status",
        handler: async (_req, res) => {
          const status = await Effect.runPromise(voice.isAvailable())
          sendJson(res, 200, { ok: true, data: status })
        },
      },
      {
        method: "POST",
        pattern: "/api/voice/transcribe",
        handler: async (req, res) => {
          const audioBuffer = await readBodyRaw(req)
          const text = await Effect.runPromise(voice.transcribe(audioBuffer))
          sendJson(res, 200, { ok: true, data: { text } })
        },
      },
      {
        method: "POST",
        pattern: "/api/voice/synthesize",
        handler: async (req, res) => {
          const body = JSON.parse(await readBody(req))
          const audioBuffer = await Effect.runPromise(voice.synthesize(body.text))
          res.writeHead(200, {
            "Content-Type": "audio/ogg",
            "Content-Length": audioBuffer.length,
            "Access-Control-Allow-Origin": "*",
          })
          res.end(audioBuffer)
        },
      },

      // ── Briefing ──

      {
        method: "GET",
        pattern: "/api/briefing",
        handler: async (_req, res) => {
          const projects = await Effect.runPromise(db.getProjects())
          const activeProjects = projects.filter(p => p.status === "active")

          const sections: string[] = []

          for (const project of activeProjects) {
            const board = await Effect.runPromise(kanban.getBoard(project.id))
            const docs = await Effect.runPromise(db.getProjectDocuments(project.id))
            const recentDecisions = await Effect.runPromise(db.getDecisions(project.id))

            const inProgress = board.in_progress
            const backlog = board.backlog
            const doneRecently = board.done.slice(0, 3)
            const stateDoc = docs.find(d => d.type === "state")
            const assumptionsDoc = docs.find(d => d.type === "assumptions")

            let section = `## ${project.name}\n`

            if (stateDoc) {
              section += `${stateDoc.content}\n\n`
            }

            if (inProgress.length > 0) {
              section += `**In Progress:** ${inProgress.map(c => c.title).join(", ")}\n`
            }
            if (doneRecently.length > 0) {
              section += `**Recently Done:** ${doneRecently.map(c => c.title).join(", ")}\n`
            }
            if (backlog.length > 0) {
              section += `**Backlog:** ${backlog.length} items\n`
            }

            if (recentDecisions.length > 0) {
              const latest = recentDecisions[0]
              section += `**Last Decision:** ${latest.title}\n`
            }

            if (assumptionsDoc && assumptionsDoc.content) {
              const assumptions = assumptionsDoc.content.split("\n").filter(l => l.trim())
              section += `**Open Assumptions:** ${assumptions.length}\n`
            }

            sections.push(section)
          }

          const briefing = sections.length > 0
            ? `# Briefing\n\n${sections.join("\n---\n\n")}`
            : "# Briefing\n\nNo active projects. Time to start something new."

          sendJson(res, 200, { ok: true, data: { briefing, projectCount: activeProjects.length } })
        },
      },

      // ── Cross-project connections ──

      {
        method: "GET",
        pattern: "/api/connections",
        handler: async (_req, res) => {
          const projects = await Effect.runPromise(db.getProjects())
          const activeProjects = projects.filter(p => p.status === "active")

          if (activeProjects.length < 2) {
            sendJson(res, 200, { ok: true, data: [] })
            return
          }

          const projectData = await Promise.all(
            activeProjects.map(async (p) => {
              const docs = await Effect.runPromise(db.getProjectDocuments(p.id))
              const decisions = await Effect.runPromise(db.getDecisions(p.id))
              const board = await Effect.runPromise(kanban.getBoard(p.id))

              const textBlob = [
                ...docs.map(d => `${d.title} ${d.content}`),
                ...decisions.map(d => `${d.title} ${d.description} ${d.reasoning}`),
                ...board.backlog.map(c => `${c.title} ${c.description}`),
                ...board.in_progress.map(c => `${c.title} ${c.description}`),
                ...board.done.map(c => `${c.title} ${c.description}`),
              ].join(" ").toLowerCase()

              return {
                id: p.id,
                name: p.name,
                textBlob,
                decisions,
                docs,
                techKeywords: extractTechKeywords(textBlob),
              }
            })
          )

          const connections: Array<{
            type: "shared_pattern" | "contradiction" | "reusable_work"
            projects: string[]
            description: string
          }> = []

          for (let i = 0; i < projectData.length; i++) {
            for (let j = i + 1; j < projectData.length; j++) {
              const a = projectData[i]
              const b = projectData[j]

              const shared = a.techKeywords.filter(k => b.techKeywords.includes(k))
              if (shared.length >= 2) {
                connections.push({
                  type: "shared_pattern",
                  projects: [a.name, b.name],
                  description: `Both use: ${shared.slice(0, 4).join(", ")}`,
                })
              }

              for (const decA of a.decisions) {
                for (const decB of b.decisions) {
                  const titleOverlap = decA.title.toLowerCase().split(/\s+/)
                    .filter(w => w.length > 3)
                    .some(w => decB.title.toLowerCase().includes(w))
                  if (titleOverlap && decA.title !== decB.title) {
                    connections.push({
                      type: "contradiction",
                      projects: [a.name, b.name],
                      description: `"${decA.title}" vs "${decB.title}" — different approaches?`,
                    })
                  }
                }
              }

              const aDocTypes = new Set(a.docs.map(d => d.type))
              const bDocTypes = new Set(b.docs.map(d => d.type))
              if (aDocTypes.has("reference") && bDocTypes.has("reference")) {
                const aRefTitles = a.docs.filter(d => d.type === "reference").map(d => d.title.toLowerCase())
                const bRefTitles = b.docs.filter(d => d.type === "reference").map(d => d.title.toLowerCase())
                for (const title of aRefTitles) {
                  const words = title.split(/\s+/).filter(w => w.length > 3)
                  for (const bTitle of bRefTitles) {
                    if (words.some(w => bTitle.includes(w))) {
                      connections.push({
                        type: "reusable_work",
                        projects: [a.name, b.name],
                        description: `Shared reference material may apply to both`,
                      })
                    }
                  }
                }
              }
            }
          }

          const seen = new Set<string>()
          const unique = connections.filter(c => {
            if (seen.has(c.description)) return false
            seen.add(c.description)
            return true
          })

          sendJson(res, 200, { ok: true, data: unique.slice(0, 10) })
        },
      },

      // ── Fragment stitcher ──

      {
        method: "POST",
        pattern: "/api/fragments",
        handler: async (req, res) => {
          const body = JSON.parse(await readBody(req)) as { content: string; projectId?: string }
          const { content, projectId } = body
          if (!content) {
            sendJson(res, 400, { ok: false, error: "content required" })
            return
          }

          let targetProjectId = projectId
          let targetProjectName = ""

          if (!targetProjectId) {
            const projects = await Effect.runPromise(db.getProjects())
            const activeProjects = projects.filter(p => p.status === "active")
            const contentLower = content.toLowerCase()

            let bestMatch: { id: string; name: string; score: number } | null = null
            for (const p of activeProjects) {
              let score = 0
              if (contentLower.includes(p.name.toLowerCase())) score += 10
              if (p.description) {
                const descWords = p.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)
                score += descWords.filter(w => contentLower.includes(w)).length
              }
              if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = { id: p.id, name: p.name, score }
              }
            }

            if (bestMatch) {
              targetProjectId = bestMatch.id
              targetProjectName = bestMatch.name
            }
          }

          await Effect.runPromise(
            db.saveMessage({
              id: crypto.randomUUID(),
              projectId: targetProjectId ?? null,
              conversationId: undefined,
              role: "user",
              content: `[Fragment] ${content}`,
              timestamp: Date.now(),
            })
          )

          if (targetProjectId) {
            try {
              await Effect.runPromise(
                kanban.createCard(targetProjectId, `Fragment: ${content.slice(0, 80)}`, content, "backlog")
              )
            } catch {
              // Card creation is best-effort
            }
          }

          sendJson(res, 200, {
            ok: true,
            data: {
              projectId: targetProjectId || null,
              projectName: targetProjectName || null,
              action: targetProjectId ? "Filed into project + created backlog card" : "Saved to general thread",
            },
          })
        },
      },

      // ── Agent orchestration ──

      {
        method: "POST",
        pattern: "/api/agents/spawn",
        handler: async (req, res) => {
          const body = JSON.parse(await readBody(req))
          const result = await Effect.runPromise(
            agentOrchestrator.spawnAgent({
              cardId: body.cardId,
              projectId: body.projectId,
              agent: body.agent,
              prompt: body.prompt,
              cwd: body.cwd || config.workspace.path,
            }).pipe(
              Effect.catchAll((err) =>
                Effect.succeed({ error: err.message })
              )
            )
          )
          if ("error" in result) {
            sendJson(res, 400, { ok: false, error: result.error })
          } else {
            sendJson(res, 200, { ok: true, data: { cardId: result.cardId, agent: result.agent, branchName: result.branchName } })
          }
        },
      },
      {
        method: "GET",
        pattern: "/api/agents",
        handler: async (_req, res) => {
          const agents = await Effect.runPromise(agentOrchestrator.getRunningAgents())
          sendJson(res, 200, { ok: true, data: agents })
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/agents\/([^/]+)\/logs$/,
        paramNames: ["cardId"],
        handler: async (_req, res, { params, searchParams }) => {
          const limit = parseInt(searchParams.get("limit") || "100")
          const logs = await Effect.runPromise(agentOrchestrator.getAgentLogs(params.cardId, limit))
          sendJson(res, 200, { ok: true, data: logs })
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/agents\/([^/]+)$/,
        paramNames: ["cardId"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(
            agentOrchestrator.stopAgent(params.cardId).pipe(
              Effect.catchAll((err) =>
                Effect.logError(`Failed to stop agent: ${err.message}`)
              )
            )
          )
          sendJson(res, 200, { ok: true })
        },
      },

      // ── Steering corrections ──

      {
        method: "GET",
        pattern: "/api/steering/prompt",
        handler: async (_req, res, { searchParams }) => {
          const projectId = searchParams.get("projectId") ?? undefined
          const block = await Effect.runPromise(steeringEngine.buildPromptBlock(projectId))
          sendJson(res, 200, { ok: true, data: block })
        },
      },
      {
        method: "GET",
        pattern: "/api/steering",
        handler: async (_req, res, { searchParams }) => {
          const domain = searchParams.get("domain") as CorrectionDomain | null
          const projectId = searchParams.get("projectId")
          const includeInactive = searchParams.get("includeInactive") === "true"
          const corrections = await Effect.runPromise(
            steeringEngine.query({
              domain: domain ?? undefined,
              projectId: projectId ?? undefined,
              activeOnly: !includeInactive,
            })
          )
          sendJson(res, 200, { ok: true, data: corrections })
        },
      },
      {
        method: "POST",
        pattern: "/api/steering",
        handler: async (req, res) => {
          const body = JSON.parse(await readBody(req))
          const { correction, domain, source, context, projectId } = body as {
            correction: string
            domain: CorrectionDomain
            source: CorrectionSource
            context?: string
            projectId?: string
          }
          if (!correction || !domain || !source) {
            sendJson(res, 400, { ok: false, error: "correction, domain, and source are required" })
            return
          }
          const result = await Effect.runPromise(
            steeringEngine.capture(correction, domain, source, context, projectId)
          )
          sendJson(res, 201, { ok: true, data: result })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/steering\/([^/]+)\/deactivate$/,
        paramNames: ["id"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(steeringEngine.deactivate(params.id))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/steering\/([^/]+)\/reactivate$/,
        paramNames: ["id"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(steeringEngine.reactivate(params.id))
          sendJson(res, 200, { ok: true })
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/steering\/([^/]+)$/,
        paramNames: ["id"],
        handler: async (_req, res, { params }) => {
          await Effect.runPromise(steeringEngine.remove(params.id))
          sendJson(res, 200, { ok: true })
        },
      },

      // ── Search, Audit, Usage ──

      {
        method: "GET",
        pattern: "/api/search",
        handler: async (_req, res, { searchParams }) => {
          const q = searchParams.get("q") || ""
          const searchProjectId = searchParams.get("project_id") || undefined
          if (!q) {
            sendJson(res, 400, { ok: false, error: "q parameter is required" })
            return
          }
          const results = await Effect.runPromise(db.search(q, searchProjectId))
          sendJson(res, 200, { ok: true, data: { results } })
        },
      },
      {
        method: "GET",
        pattern: "/api/audit",
        handler: async (_req, res, { searchParams }) => {
          const filters: AuditLogFilters = {
            entityType: searchParams.get("entity_type") ?? undefined,
            entityId: searchParams.get("entity_id") ?? undefined,
            limit: searchParams.has("limit") ? parseInt(searchParams.get("limit")!) : undefined,
            offset: searchParams.has("offset") ? parseInt(searchParams.get("offset")!) : undefined,
          }
          const result = await Effect.runPromise(db.getAuditLog(filters))
          sendJson(res, 200, { ok: true, data: result })
        },
      },
      {
        method: "GET",
        pattern: "/api/usage",
        handler: async (_req, res, { searchParams }) => {
          const projectId = searchParams.get("project_id") || undefined
          const days = parseInt(searchParams.get("days") || "30")
          const summary = await Effect.runPromise(db.getUsageSummary(projectId, days))
          sendJson(res, 200, { ok: true, data: summary })
        },
      },

      // ── Backup ──

      {
        method: "GET",
        pattern: "/api/backup",
        handler: async (_req, res) => {
          const dbDir = nodePath.dirname(config.database.path)
          const timestamp = Date.now()
          const backupFileName = `backup-${timestamp}.db`
          const backupPath = nodePath.join(dbDir, backupFileName)

          try {
            await Effect.runPromise(db.backupDatabase(backupPath))
          } catch (err) {
            console.error("[AppServer] Backup failed:", err)
            sendJson(res, 500, { ok: false, error: "Backup failed" })
            return
          }

          const stat = fs.statSync(backupPath)
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${backupFileName}"`,
            "Content-Length": stat.size,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
          })

          const stream = fs.createReadStream(backupPath)
          stream.pipe(res)
          stream.on("error", (err) => {
            console.error("[AppServer] Backup stream error:", err)
            res.end()
            fs.unlink(backupPath, () => {})
          })
          res.on("finish", () => {
            fs.unlink(backupPath, () => {})
          })
        },
      },
    ]

    // Routes that don't require authentication
    const AUTH_EXEMPT_PATTERNS = new Set([
      "/api/health",
      "/api/auth/token",
    ])

    const routeMatch = createRouter(routes, baseUrl)

    const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
      // CORS preflight
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null)
        return
      }

      const url = new URL(req.url || "/", baseUrl)
      const path = url.pathname

      // Auth check (skip for auth-exempt routes)
      if (!AUTH_EXEMPT_PATTERNS.has(path) && !authenticate(req, authToken, baseUrl)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" })
        return
      }

      try {
        const matched = await routeMatch(req, res)
        if (!matched) {
          sendJson(res, 404, { ok: false, error: "Not found" })
        }
      } catch (err) {
        console.error("API error:", err)
        sendJson(res, 500, { ok: false, error: "Internal server error" })
      }
    }

    // Register finalizer
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const client of clients) {
          client.close()
        }
        clients.clear()
        if (wss) {
          wss.close();
        }
        if (httpServer) {
          httpServer.close();
        }
      })
    );

    return {
      start: () =>
        Effect.gen(function* () {
          // Dynamic import ws
          const { WebSocketServer } = yield* Effect.tryPromise({
            try: () => import("ws"),
            catch: () => new Error("Failed to load ws module. Run: npm install ws @types/ws"),
          });

          if (useTls) {
            const cert = readFileSync(tlsCertPath!);
            const key = readFileSync(tlsKeyPath!);
            httpServer = createHttpsServer({ cert, key }, handleRequest);
          } else {
            httpServer = createServer(handleRequest);
          }
          wss = new WebSocketServer({ noServer: true });

          // Explicit upgrade handler — only accept /ws path
          httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            const url = new URL(req.url || "/", `http://localhost:${port}`)
            if (url.pathname !== "/ws") {
              socket.destroy()
              return
            }
            wss.handleUpgrade(req, socket, head, (ws: any) => {
              wss.emit("connection", ws, req)
            })
          })

          // Track per-client project subscriptions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clientSubscriptions = new Map<any, Set<string>>();

          // Wire agent broadcast to WebSocket clients (project-scoped)
          setAgentBroadcast((message) => {
            const data = JSON.stringify(message);
            const messageProjectId = typeof message.projectId === "string" ? message.projectId : null;
            for (const client of clients) {
              if (client.readyState !== 1) continue;
              if (messageProjectId) {
                const subs = clientSubscriptions.get(client);
                if (!subs || !subs.has(messageProjectId)) continue;
              }
              client.send(data);
            }
          });
          setHeartbeatBroadcast((message) => {
            broadcast(message)
          });

          // Wire heartbeat broadcast to WebSocket clients
          setHeartbeatBroadcast((message) => {
            const data = JSON.stringify(message);
            wss.clients?.forEach((client: any) => {
              if (client.readyState === 1) { // WebSocket.OPEN
                client.send(data);
              }
            });
          });

          // Context handoff threshold (percentage of context window)
          const HANDOFF_THRESHOLD = 50;

          // Helper: get or create active conversation for a thread
          const getOrCreateConversation = async (projectId: string | null): Promise<AppConversation> => {
            const existing = await Effect.runPromise(db.getActiveConversation(projectId));
            if (existing) return existing;
            return await Effect.runPromise(db.createConversation(projectId));
          };

          // Helper: build prompt with project context + conversation memory
          const buildPrompt = async (userMessage: string, projectId: string | null, conversation: AppConversation): Promise<string> => {
            let prompt = userMessage;

            // Inject project context and workspace actions if scoped to a project
            if (projectId) {
              try {
                const context = await Effect.runPromise(thinkingPartner.getProjectContext(projectId));
                if (context) {
                  prompt = `${context}\n\n${WORKSPACE_ACTIONS_PROMPT}\n\n---\n\nUser message:\n${userMessage}`;
                } else {
                  prompt = `${WORKSPACE_ACTIONS_PROMPT}\n\n---\n\nUser message:\n${userMessage}`;
                }
              } catch {
                prompt = `${WORKSPACE_ACTIONS_PROMPT}\n\n---\n\nUser message:\n${userMessage}`;
              }
            }

            // If this is a fresh session (no Claude session ID), inject previous conversation summary
            if (!conversation.claudeSessionId) {
              try {
                const recent = await Effect.runPromise(db.getRecentConversations(projectId, 3));
                const archived = recent.filter((c) => c.status === "archived" && c.summary);
                if (archived.length > 0) {
                  const summary = archived[0].summary!;
                  // Truncate summary to ~4000 chars to avoid bloating the prompt
                  const trimmed = summary.length > 4000 ? summary.slice(0, 4000) + "\n\n[Summary truncated]" : summary;
                  prompt = `Previous conversation context:\n${trimmed}\n\n---\n\n${prompt}`;
                }
              } catch { /* ignore memory injection failures */ }
            }

            return prompt;
          };

          // Helper: handle context usage and auto-handoff
          const checkContextHandoff = async (
            conversation: AppConversation,
            sessionId: string | undefined,
            projectId: string | null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ws: any,
            usage?: { inputTokens: number; outputTokens: number; contextWindow: number }
          ) => {
            if (!usage) return;

            const contextPercent = ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100;
            await Effect.runPromise(db.updateConversationContext(conversation.id, contextPercent));

            if (contextPercent >= HANDOFF_THRESHOLD && sessionId) {
              ws.send(JSON.stringify({
                type: "chat.handoff",
                message: `Context at ${contextPercent.toFixed(0)}%. Creating summary and continuing...`,
              }));

              try {
                const summary = await Effect.runPromise(
                  claude.generateHandoff({ sessionId, cwd: config.workspace.path })
                );
                await Effect.runPromise(db.archiveConversation(conversation.id, summary));
                const newConv = await Effect.runPromise(db.createConversation(projectId));
                ws.send(JSON.stringify({
                  type: "chat.handoff_complete",
                  conversationId: newConv.id,
                  message: "Context reset. Continuing with fresh session.",
                }));
              } catch (err) {
                console.error("[AppServer] Handoff failed:", err);
              }
            }
          };

          // Helper: parse workspace action blocks from Claude's response
          const parseActions = parseWorkspaceActions;

          // Helper: strip action blocks from text before displaying to user
          const stripActions = (text: string): string => {
            return text.replace(/:::action\s*\n[\s\S]*?\n:::/g, "").trim();
          };

          // Helper: execute workspace actions and notify client
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const executeActions = async (actions: WorkspaceAction[], projectId: string, ws: any) => {
            for (const action of actions) {
              try {
                switch (action.type) {
                  case "create_card": {
                    if (!action.title) break;
                    const card = await Effect.runPromise(
                      kanban.createCard(projectId, action.title, action.description || "", action.column || "backlog")
                    );
                    ws.send(JSON.stringify({
                      type: "workspace.action",
                      action: "card_created",
                      data: { id: card.id, title: card.title, column: card.column },
                    }));
                    console.log(`[Workspace] Created card: "${card.title}" in ${card.column}`);
                    break;
                  }
                  case "move_card": {
                    if (!action.title || !action.column) break;
                    const validColumns = ["backlog", "in_progress", "done"] as const;
                    if (!validColumns.includes(action.column as typeof validColumns[number])) break;
                    // Find card by title substring match
                    const cards = await Effect.runPromise(db.getCards(projectId));
                    const target = cards.find(c =>
                      c.title.toLowerCase().includes(action.title!.toLowerCase())
                    );
                    if (target) {
                      await Effect.runPromise(
                        kanban.moveCard(target.id, action.column as "backlog" | "in_progress" | "done")
                      );
                      ws.send(JSON.stringify({
                        type: "workspace.action",
                        action: "card_moved",
                        data: { id: target.id, title: target.title, column: action.column },
                      }));
                      console.log(`[Workspace] Moved card: "${target.title}" → ${action.column}`);
                    }
                    break;
                  }
                  case "log_decision": {
                    if (!action.title) break;
                    const decision = await Effect.runPromise(
                      thinkingPartner.logDecision(projectId, {
                        title: action.title,
                        description: action.description || "",
                        alternatives: action.alternatives || [],
                        reasoning: action.reasoning || "",
                        tradeoffs: action.tradeoffs || "",
                      })
                    );
                    ws.send(JSON.stringify({
                      type: "workspace.action",
                      action: "decision_logged",
                      data: { id: decision.id, title: decision.title },
                    }));
                    console.log(`[Workspace] Logged decision: "${decision.title}"`);
                    break;
                  }
                  case "add_assumption": {
                    if (!action.assumption) break;
                    await Effect.runPromise(
                      thinkingPartner.addAssumption(projectId, action.assumption)
                    );
                    ws.send(JSON.stringify({
                      type: "workspace.action",
                      action: "assumption_tracked",
                      data: { assumption: action.assumption },
                    }));
                    console.log(`[Workspace] Tracked assumption: "${action.assumption}"`);
                    break;
                  }
                  case "update_state": {
                    if (!action.summary) break;
                    await Effect.runPromise(
                      thinkingPartner.updateStateSummary(projectId, action.summary)
                    );
                    ws.send(JSON.stringify({
                      type: "workspace.action",
                      action: "state_updated",
                      data: { summary: action.summary.slice(0, 200) },
                    }));
                    console.log(`[Workspace] Updated project state summary`);
                    break;
                  }
                }
              } catch (err) {
                console.error(`[Workspace] Action failed:`, action.type, err);
              }
            }
          };

          // Heartbeat: ping all clients every 30 seconds, terminate dead connections
          const HEARTBEAT_INTERVAL = 30_000;
          const HEARTBEAT_MISSED_LIMIT = 2;
          const serverStartedAt = Date.now();
          let heartbeatTick = 0;

          const heartbeatTimer = setInterval(() => {
            heartbeatTick++;

            for (const client of clients) {
              if (client._missedPings >= HEARTBEAT_MISSED_LIMIT) {
                console.log("[AppServer] Terminating dead WebSocket client (missed", client._missedPings, "pings)")
                client.terminate()
                clients.delete(client)
                continue
              }
              client._missedPings = (client._missedPings || 0) + 1
              if (client.readyState === 1) { // WebSocket.OPEN
                client.send(JSON.stringify({ type: "ping" }))
              }
            }

            // Broadcast heartbeat status to all clients
            const agentCount = Effect.runSync(agentOrchestrator.getRunningAgents()).filter(
              (a) => a.status === "running"
            ).length;
            const uptimeSeconds = Math.round((Date.now() - serverStartedAt) / 1000);
            const statusMsg = JSON.stringify({
              type: "system.heartbeat",
              tick: heartbeatTick,
              agents: agentCount,
              uptime: uptimeSeconds,
            });
            for (const client of clients) {
              if (client.readyState === 1) {
                client.send(statusMsg);
              }
            }
          }, HEARTBEAT_INTERVAL);

          // Clean up heartbeat on server close
          wss.on("close", () => {
            clearInterval(heartbeatTimer);
          });

          // WebSocket connection handler
          wss.on("connection", (ws: any, req: IncomingMessage) => {
            // Auth check for WebSocket
            if (!authenticate(req, authToken, baseUrl)) {
              ws.close(4001, "Unauthorized");
              return;
            }

            // Track client in local Set
            clients.add(ws)

            const connectedAt = Date.now();
            ws._missedPings = 0;
            console.log("[AppServer] WebSocket client connected (total:", clients.size, ")");

            // Send presence state
            ws.send(JSON.stringify({ type: "presence", state: "idle" }));

            ws.on("message", async (data: Buffer) => {
              try {
                const msg = JSON.parse(data.toString());

                if (msg.type === "ping") {
                  ws.send(JSON.stringify({ type: "pong" }));
                  return;
                }

                if (msg.type === "pong") {
                  ws._missedPings = 0;
                  return;
                }

                if (msg.type === "subscribe") {
                  const projectId = typeof msg.projectId === "string" ? msg.projectId : null;
                  if (projectId) {
                    let subs = clientSubscriptions.get(ws);
                    if (!subs) {
                      subs = new Set();
                      clientSubscriptions.set(ws, subs);
                    }
                    subs.add(projectId);
                    console.log(`[AppServer] Client subscribed to project ${projectId}`);
                  }
                  return;
                }

                if (msg.type === "chat") {
                  const projectId: string | null = msg.projectId || null;
                  const conversation = await getOrCreateConversation(projectId);
                  const messageId = crypto.randomUUID();

                  // Save user message
                  await Effect.runPromise(
                    db.saveMessage({
                      id: messageId,
                      projectId,
                      conversationId: conversation.id,
                      role: "user",
                      content: msg.content,
                      timestamp: Date.now(),
                    })
                  );
                  await Effect.runPromise(db.incrementMessageCount(conversation.id));

                  // Send thinking state
                  ws.send(JSON.stringify({ type: "presence", state: "thinking" }));

                  // Build prompt with project context + conversation memory
                  const prompt = await buildPrompt(msg.content, projectId, conversation);
                  const resumeSessionId = conversation.claudeSessionId || undefined;

                  // Stream Claude response
                  const responseId = crypto.randomUUID();
                  let fullResponse = "";
                  let capturedSessionId: string | undefined;

                  const events = claude.sendMessage({
                    prompt,
                    cwd: config.workspace.path,
                    resumeSessionId,
                  });

                  await Effect.runPromise(
                    Stream.runForEach(events, (event) =>
                      Effect.sync(() => {
                        switch (event.type) {
                          case "text":
                            if (event.sessionId && !capturedSessionId) {
                              capturedSessionId = event.sessionId;
                              Effect.runPromise(db.updateConversationSession(conversation.id, event.sessionId)).catch(console.error);
                            }
                            if (event.content) {
                              fullResponse += event.content;
                              ws.send(JSON.stringify({
                                type: "chat.stream",
                                content: event.content,
                                messageId: responseId,
                              }));
                            }
                            break;
                          case "tool_call":
                            if (event.toolCall) {
                              ws.send(JSON.stringify({
                                type: "chat.tool_call",
                                name: event.toolCall.name,
                                input: JSON.stringify(event.toolCall.input).slice(0, 200),
                              }));
                            }
                            break;
                          case "result": {
                            if (event.sessionId) {
                              capturedSessionId = event.sessionId;
                              Effect.runPromise(db.updateConversationSession(conversation.id, event.sessionId)).catch(console.error);
                            }

                            // Parse and execute workspace actions from response
                            const chatActions = parseActions(fullResponse);
                            const cleanResponse = chatActions.length > 0 ? stripActions(fullResponse) : fullResponse;

                            // Save assistant message (with action blocks stripped)
                            const assistantMsg = {
                              id: responseId,
                              projectId,
                              conversationId: conversation.id,
                              role: "assistant" as const,
                              content: cleanResponse,
                              timestamp: Date.now(),
                              metadata: event.usage ? {
                                tokens: { input: event.usage.inputTokens, output: event.usage.outputTokens },
                                cost: event.cost,
                              } : undefined,
                            };

                            Effect.runPromise(db.saveMessage(assistantMsg)).catch(console.error);
                            Effect.runPromise(db.incrementMessageCount(conversation.id)).catch(console.error);

                            ws.send(JSON.stringify({
                              type: "chat.complete",
                              messageId: responseId,
                              message: assistantMsg,
                            }));

                            // Execute workspace actions (cards, decisions, assumptions)
                            if (chatActions.length > 0 && projectId) {
                              executeActions(chatActions, projectId, ws).catch(console.error);
                            }

                            ws.send(JSON.stringify({ type: "presence", state: "idle" }));

                            // Check context usage for auto-handoff
                            checkContextHandoff(conversation, capturedSessionId, projectId, ws, event.usage).catch(console.error);
                            break;
                          }
                          case "error":
                            ws.send(JSON.stringify({
                              type: "chat.error",
                              error: event.error || "Unknown error",
                            }));
                            ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                            break;
                        }
                      })
                    ).pipe(
                      Effect.catchAll((err) =>
                        Effect.sync(() => {
                          ws.send(JSON.stringify({ type: "chat.error", error: err.message }));
                          ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                        })
                      )
                    )
                  );
                }
                if (msg.type === "voice") {
                  const projectId: string | null = msg.projectId || null;
                  const conversation = await getOrCreateConversation(projectId);

                  // Voice message: base64 audio → transcribe → Claude → synthesize → audio back
                  ws.send(JSON.stringify({ type: "presence", state: "thinking" }));

                  const audioBuffer = Buffer.from(msg.audio, "base64");

                  // Transcribe
                  let transcribedText: string;
                  try {
                    transcribedText = await Effect.runPromise(voice.transcribe(audioBuffer));
                  } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : "Unknown error";
                    ws.send(JSON.stringify({ type: "chat.error", error: `Transcription failed: ${errMsg}` }));
                    ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                    return;
                  }

                  // Send transcription to client
                  const userMessageId = crypto.randomUUID();
                  ws.send(JSON.stringify({
                    type: "chat.transcription",
                    messageId: userMessageId,
                    text: transcribedText,
                  }));

                  // Save user message
                  await Effect.runPromise(
                    db.saveMessage({
                      id: userMessageId,
                      projectId,
                      conversationId: conversation.id,
                      role: "user",
                      content: transcribedText,
                      timestamp: Date.now(),
                      metadata: { voiceNote: true },
                    })
                  );
                  await Effect.runPromise(db.incrementMessageCount(conversation.id));

                  // Build prompt with project context + conversation memory
                  const prompt = await buildPrompt(transcribedText, projectId, conversation);
                  const resumeSessionId = conversation.claudeSessionId || undefined;

                  // Stream Claude response
                  const responseId = crypto.randomUUID();
                  let fullResponse = "";
                  let capturedSessionId: string | undefined;

                  const events = claude.sendMessage({
                    prompt,
                    cwd: config.workspace.path,
                    resumeSessionId,
                  });

                  await Effect.runPromise(
                    Stream.runForEach(events, (event) =>
                      Effect.sync(() => {
                        switch (event.type) {
                          case "text":
                            if (event.sessionId && !capturedSessionId) {
                              capturedSessionId = event.sessionId;
                              Effect.runPromise(db.updateConversationSession(conversation.id, event.sessionId)).catch(console.error);
                            }
                            if (event.content) {
                              fullResponse += event.content;
                              ws.send(JSON.stringify({
                                type: "chat.stream",
                                content: event.content,
                                messageId: responseId,
                              }));
                            }
                            break;
                          case "tool_call":
                            if (event.toolCall) {
                              ws.send(JSON.stringify({
                                type: "chat.tool_call",
                                name: event.toolCall.name,
                                input: JSON.stringify(event.toolCall.input).slice(0, 200),
                              }));
                            }
                            break;
                          case "result": {
                            if (event.sessionId) {
                              capturedSessionId = event.sessionId;
                              Effect.runPromise(db.updateConversationSession(conversation.id, event.sessionId)).catch(console.error);
                            }

                            // Parse and execute workspace actions from response
                            const voiceActions = parseActions(fullResponse);
                            const cleanVoiceResponse = voiceActions.length > 0 ? stripActions(fullResponse) : fullResponse;

                            const assistantMsg = {
                              id: responseId,
                              projectId,
                              conversationId: conversation.id,
                              role: "assistant" as const,
                              content: cleanVoiceResponse,
                              timestamp: Date.now(),
                              metadata: event.usage ? {
                                tokens: { input: event.usage.inputTokens, output: event.usage.outputTokens },
                                cost: event.cost,
                              } : undefined,
                            };

                            Effect.runPromise(db.saveMessage(assistantMsg)).catch(console.error);
                            Effect.runPromise(db.incrementMessageCount(conversation.id)).catch(console.error);

                            ws.send(JSON.stringify({
                              type: "chat.complete",
                              messageId: responseId,
                              message: assistantMsg,
                            }));

                            // Execute workspace actions (cards, decisions, assumptions)
                            if (voiceActions.length > 0 && projectId) {
                              executeActions(voiceActions, projectId, ws).catch(console.error);
                            }

                            // Synthesize voice response (use clean response without action blocks)
                            ws.send(JSON.stringify({ type: "presence", state: "speaking" }));
                            Effect.runPromise(voice.synthesize(cleanVoiceResponse)).then((audio) => {
                              ws.send(JSON.stringify({
                                type: "chat.audio",
                                messageId: responseId,
                                audio: audio.toString("base64"),
                                format: "ogg",
                              }));
                              ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                            }).catch((err) => {
                              console.error("[AppServer] Voice synthesis failed:", err);
                              ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                            });

                            // Check context usage for auto-handoff
                            checkContextHandoff(conversation, capturedSessionId, projectId, ws, event.usage).catch(console.error);
                            break;
                          }
                          case "error":
                            ws.send(JSON.stringify({ type: "chat.error", error: event.error || "Unknown error" }));
                            ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                            break;
                        }
                      })
                    ).pipe(
                      Effect.catchAll((err) =>
                        Effect.sync(() => {
                          ws.send(JSON.stringify({ type: "chat.error", error: err.message }));
                          ws.send(JSON.stringify({ type: "presence", state: "idle" }));
                        })
                      )
                    )
                  );
                }
              } catch (err) {
                console.error("[AppServer] WS message error:", err);
                ws.send(JSON.stringify({
                  type: "chat.error",
                  error: "Failed to process message",
                }));
              }
            });

            ws.on("close", () => {
              clients.delete(ws)
              clientSubscriptions.delete(ws);
              const duration = Math.round((Date.now() - connectedAt) / 1000);
              console.log(`[AppServer] WebSocket client disconnected after ${duration}s (remaining: ${clients.size})`);
            });
          });

          // Start listening
          yield* Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                httpServer!.listen(port, () => {
                  const proto = useTls ? "HTTPS" : "HTTP";
                  console.log(`[AppServer] ${proto}/WS server listening on port ${port}`);
                  resolve();
                });
                httpServer!.on("error", reject);
              }),
            catch: (err) => new Error(`Failed to start AppServer: ${err}`),
          });
        }),

      stop: () =>
        Effect.sync(() => {
          for (const client of clients) {
            client.close()
          }
          clients.clear()
          if (wss) {
            wss.close();
          }
          if (httpServer) {
            httpServer.close();
          }
        }),
    };
  })
);
