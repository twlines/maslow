/**
 * App Server Service
 *
 * HTTP/WS API server for the Maslow web and mobile apps.
 * Runs alongside the Telegram bot on a separate port.
 */

import { Context, Effect, Layer, Stream } from "effect";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync } from "fs";
import { ConfigService } from "./Config.js";
import { ClaudeSession } from "./ClaudeSession.js";
import { AppPersistence, type AppConversation } from "./AppPersistence.js";
import { Voice } from "./Voice.js";
import { Kanban } from "./Kanban.js";
import { ThinkingPartner } from "./ThinkingPartner.js";
import { AgentOrchestrator, setAgentBroadcast } from "./AgentOrchestrator.js";
import { SteeringEngine } from "./SteeringEngine.js";
import type { CorrectionDomain, CorrectionSource } from "./AppPersistence.js";

// Simple token auth for single user
const AUTH_TOKEN_HEADER = "authorization";

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

interface WorkspaceAction {
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
    let wss: any = null; // WebSocketServer

    const authenticate = (req: IncomingMessage): boolean => {
      if (!authToken) return true; // No auth configured = open (dev mode)
      const header = req.headers[AUTH_TOKEN_HEADER];
      return header === `Bearer ${authToken}`;
    };

    const sendJson = (res: ServerResponse, status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      });
      res.end(JSON.stringify(data));
    };

    const readBody = (req: IncomingMessage): Promise<string> =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
      });

    const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
      // CORS preflight
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null);
        return;
      }

      // Auth check (skip for OPTIONS)
      if (!authenticate(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const url = new URL(req.url || "/", `http://localhost:${port}`);
      const path = url.pathname;
      const method = req.method || "GET";

      try {
        // Auth
        if (path === "/api/auth/token" && method === "POST") {
          const body = JSON.parse(await readBody(req));
          if (body.token === authToken) {
            sendJson(res, 200, { ok: true, data: { authenticated: true } });
          } else {
            sendJson(res, 401, { ok: false, error: "Invalid token" });
          }
          return;
        }

        // Messages - GET /api/messages?projectId=xxx&limit=50&offset=0
        if (path === "/api/messages" && method === "GET") {
          const projectId = url.searchParams.get("projectId") || null;
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const messages = await Effect.runPromise(db.getMessages(projectId, limit, offset));
          sendJson(res, 200, { ok: true, data: messages });
          return;
        }

        // Projects - GET /api/projects
        if (path === "/api/projects" && method === "GET") {
          const projects = await Effect.runPromise(db.getProjects());
          sendJson(res, 200, { ok: true, data: projects });
          return;
        }

        // Projects - POST /api/projects
        if (path === "/api/projects" && method === "POST") {
          const body = JSON.parse(await readBody(req));
          const project = await Effect.runPromise(db.createProject(body.name, body.description || ""));
          sendJson(res, 201, { ok: true, data: project });
          return;
        }

        // Project by ID - GET/PUT /api/projects/:id
        const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
        if (projectMatch && !path.includes("/messages") && !path.includes("/docs") && !path.includes("/cards") && !path.includes("/decisions")) {
          const projectId = projectMatch[1];
          if (method === "GET") {
            const project = await Effect.runPromise(db.getProject(projectId));
            if (!project) {
              sendJson(res, 404, { ok: false, error: "Project not found" });
              return;
            }
            sendJson(res, 200, { ok: true, data: project });
            return;
          }
          if (method === "PUT") {
            const body = JSON.parse(await readBody(req));
            await Effect.runPromise(db.updateProject(projectId, body));
            sendJson(res, 200, { ok: true, data: { id: projectId, ...body } });
            return;
          }
        }

        // Project messages - GET /api/projects/:id/messages
        const projectMsgMatch = path.match(/^\/api\/projects\/([^/]+)\/messages$/);
        if (projectMsgMatch && method === "GET") {
          const projectId = projectMsgMatch[1];
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const messages = await Effect.runPromise(db.getMessages(projectId, limit, offset));
          sendJson(res, 200, { ok: true, data: messages });
          return;
        }

        // Project documents - GET/POST /api/projects/:id/docs
        const projectDocsMatch = path.match(/^\/api\/projects\/([^/]+)\/docs$/);
        if (projectDocsMatch) {
          const projectId = projectDocsMatch[1];
          if (method === "GET") {
            const docs = await Effect.runPromise(db.getProjectDocuments(projectId));
            sendJson(res, 200, { ok: true, data: docs });
            return;
          }
          if (method === "POST") {
            const body = JSON.parse(await readBody(req));
            const doc = await Effect.runPromise(db.createProjectDocument(projectId, body.type, body.title, body.content));
            sendJson(res, 201, { ok: true, data: doc });
            return;
          }
        }

        // Project document by ID - GET/PUT /api/projects/:id/docs/:docId
        const projectDocMatch = path.match(/^\/api\/projects\/([^/]+)\/docs\/([^/]+)$/);
        if (projectDocMatch) {
          const [, projectId, docId] = projectDocMatch;
          if (method === "GET") {
            const doc = await Effect.runPromise(db.getProjectDocument(docId));
            if (!doc) {
              sendJson(res, 404, { ok: false, error: "Document not found" });
              return;
            }
            sendJson(res, 200, { ok: true, data: doc });
            return;
          }
          if (method === "PUT") {
            const body = JSON.parse(await readBody(req));
            await Effect.runPromise(db.updateProjectDocument(docId, body));
            sendJson(res, 200, { ok: true, data: { id: docId, ...body } });
            return;
          }
        }

        // Kanban cards - GET/POST /api/projects/:id/cards
        const projectCardsMatch = path.match(/^\/api\/projects\/([^/]+)\/cards$/);
        if (projectCardsMatch) {
          const projectId = projectCardsMatch[1];
          if (method === "GET") {
            const board = await Effect.runPromise(kanban.getBoard(projectId));
            sendJson(res, 200, { ok: true, data: board });
            return;
          }
          if (method === "POST") {
            const body = JSON.parse(await readBody(req));
            const card = await Effect.runPromise(kanban.createCard(projectId, body.title, body.description, body.column));
            sendJson(res, 201, { ok: true, data: card });
            return;
          }
        }

        // Kanban card by ID - PUT/DELETE /api/projects/:id/cards/:cardId
        const projectCardMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)$/);
        if (projectCardMatch) {
          const [, , cardId] = projectCardMatch;
          if (method === "PUT") {
            const body = JSON.parse(await readBody(req));
            if (body.column !== undefined) {
              await Effect.runPromise(kanban.moveCard(cardId, body.column));
            }
            await Effect.runPromise(kanban.updateCard(cardId, body));
            sendJson(res, 200, { ok: true, data: { id: cardId, ...body } });
            return;
          }
          if (method === "DELETE") {
            await Effect.runPromise(kanban.deleteCard(cardId));
            sendJson(res, 200, { ok: true, data: { deleted: true } });
            return;
          }
        }

        // Kanban work queue - GET /api/projects/:id/cards/next
        const nextCardMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/next$/);
        if (nextCardMatch && method === "GET") {
          const card = await Effect.runPromise(kanban.getNext(nextCardMatch[1]));
          sendJson(res, 200, { ok: true, data: card });
          return;
        }

        // Card context - POST /api/projects/:id/cards/:cardId/context
        const cardContextMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/context$/);
        if (cardContextMatch && method === "POST") {
          const body = JSON.parse(await readBody(req));
          await Effect.runPromise(kanban.saveContext(cardContextMatch[2], body.snapshot, body.sessionId));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Card skip - POST /api/projects/:id/cards/:cardId/skip
        const cardSkipMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/skip$/);
        if (cardSkipMatch && method === "POST") {
          await Effect.runPromise(kanban.skipToBack(cardSkipMatch[2]));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Card assign - POST /api/projects/:id/cards/:cardId/assign
        const cardAssignMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/assign$/);
        if (cardAssignMatch && method === "POST") {
          const body = JSON.parse(await readBody(req));
          await Effect.runPromise(kanban.assignAgent(cardAssignMatch[2], body.agent));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Card start work - POST /api/projects/:id/cards/:cardId/start
        const cardStartMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/start$/);
        if (cardStartMatch && method === "POST") {
          const body = JSON.parse(await readBody(req));
          await Effect.runPromise(kanban.startWork(cardStartMatch[2], body.agent));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Card complete - POST /api/projects/:id/cards/:cardId/complete
        const cardCompleteMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/complete$/);
        if (cardCompleteMatch && method === "POST") {
          await Effect.runPromise(kanban.completeWork(cardCompleteMatch[2]));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Card resume - GET /api/projects/:id/cards/:cardId/resume
        const cardResumeMatch = path.match(/^\/api\/projects\/([^/]+)\/cards\/([^/]+)\/resume$/);
        if (cardResumeMatch && method === "GET") {
          const result = await Effect.runPromise(kanban.resume(cardResumeMatch[2]));
          sendJson(res, 200, { ok: true, data: result });
          return;
        }

        // Decisions - GET/POST /api/projects/:id/decisions
        const projectDecisionsMatch = path.match(/^\/api\/projects\/([^/]+)\/decisions$/);
        if (projectDecisionsMatch) {
          const projectId = projectDecisionsMatch[1];
          if (method === "GET") {
            const decisions = await Effect.runPromise(thinkingPartner.getDecisions(projectId));
            sendJson(res, 200, { ok: true, data: decisions });
            return;
          }
          if (method === "POST") {
            const body = JSON.parse(await readBody(req));
            const decision = await Effect.runPromise(thinkingPartner.logDecision(projectId, body));
            sendJson(res, 201, { ok: true, data: decision });
            return;
          }
        }

        // Project context (for loading into Claude sessions)
        const projectContextMatch = path.match(/^\/api\/projects\/([^/]+)\/context$/);
        if (projectContextMatch && method === "GET") {
          const projectId = projectContextMatch[1];
          const context = await Effect.runPromise(thinkingPartner.getProjectContext(projectId));
          sendJson(res, 200, { ok: true, data: { context } });
          return;
        }

        // Conversations - GET /api/conversations?projectId=xxx
        if (path === "/api/conversations" && method === "GET") {
          const projectId = url.searchParams.get("projectId") || null;
          const limit = parseInt(url.searchParams.get("limit") || "20");
          const conversations = await Effect.runPromise(db.getRecentConversations(projectId, limit));
          sendJson(res, 200, { ok: true, data: conversations });
          return;
        }

        // Active conversation - GET /api/conversations/active?projectId=xxx
        if (path === "/api/conversations/active" && method === "GET") {
          const projectId = url.searchParams.get("projectId") || null;
          const conversation = await Effect.runPromise(db.getActiveConversation(projectId));
          sendJson(res, 200, { ok: true, data: conversation });
          return;
        }

        // Voice status — check actual service availability
        if (path === "/api/voice/status" && method === "GET") {
          const status = await Effect.runPromise(voice.isAvailable());
          sendJson(res, 200, { ok: true, data: status });
          return;
        }

        // Voice transcribe — POST /api/voice/transcribe (body: raw audio)
        if (path === "/api/voice/transcribe" && method === "POST") {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => resolve());
            req.on("error", reject);
          });
          const audioBuffer = Buffer.concat(chunks);
          const text = await Effect.runPromise(voice.transcribe(audioBuffer));
          sendJson(res, 200, { ok: true, data: { text } });
          return;
        }

        // Voice synthesize — POST /api/voice/synthesize (body: JSON { text })
        if (path === "/api/voice/synthesize" && method === "POST") {
          const body = JSON.parse(await readBody(req));
          const audioBuffer = await Effect.runPromise(voice.synthesize(body.text));
          res.writeHead(200, {
            "Content-Type": "audio/ogg",
            "Content-Length": audioBuffer.length,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(audioBuffer);
          return;
        }

        // Briefing digest — GET /api/briefing
        if (path === "/api/briefing" && method === "GET") {
          const projects = await Effect.runPromise(db.getProjects());
          const activeProjects = projects.filter(p => p.status === "active");

          const sections: string[] = [];

          for (const project of activeProjects) {
            const board = await Effect.runPromise(kanban.getBoard(project.id));
            const docs = await Effect.runPromise(db.getProjectDocuments(project.id));
            const recentDecisions = await Effect.runPromise(db.getDecisions(project.id));

            const inProgress = board.in_progress;
            const backlog = board.backlog;
            const doneRecently = board.done.slice(0, 3);
            const stateDoc = docs.find(d => d.type === "state");
            const assumptionsDoc = docs.find(d => d.type === "assumptions");

            let section = `## ${project.name}\n`;

            if (stateDoc) {
              section += `${stateDoc.content}\n\n`;
            }

            if (inProgress.length > 0) {
              section += `**In Progress:** ${inProgress.map(c => c.title).join(", ")}\n`;
            }
            if (doneRecently.length > 0) {
              section += `**Recently Done:** ${doneRecently.map(c => c.title).join(", ")}\n`;
            }
            if (backlog.length > 0) {
              section += `**Backlog:** ${backlog.length} items\n`;
            }

            if (recentDecisions.length > 0) {
              const latest = recentDecisions[0];
              section += `**Last Decision:** ${latest.title}\n`;
            }

            if (assumptionsDoc && assumptionsDoc.content) {
              const assumptions = assumptionsDoc.content.split("\n").filter(l => l.trim());
              section += `**Open Assumptions:** ${assumptions.length}\n`;
            }

            sections.push(section);
          }

          const briefing = sections.length > 0
            ? `# Briefing\n\n${sections.join("\n---\n\n")}`
            : "# Briefing\n\nNo active projects. Time to start something new.";

          sendJson(res, 200, { ok: true, data: { briefing, projectCount: activeProjects.length } });
          return;
        }

        // Cross-project connections — GET /api/connections
        if (path === "/api/connections" && method === "GET") {
          const projects = await Effect.runPromise(db.getProjects());
          const activeProjects = projects.filter(p => p.status === "active");

          if (activeProjects.length < 2) {
            sendJson(res, 200, { ok: true, data: [] });
            return;
          }

          // Gather project data for comparison
          const projectData = await Promise.all(
            activeProjects.map(async (p) => {
              const docs = await Effect.runPromise(db.getProjectDocuments(p.id));
              const decisions = await Effect.runPromise(db.getDecisions(p.id));
              const board = await Effect.runPromise(kanban.getBoard(p.id));

              // Collect keywords from briefs, instructions, decisions
              const textBlob = [
                ...docs.map(d => `${d.title} ${d.content}`),
                ...decisions.map(d => `${d.title} ${d.description} ${d.reasoning}`),
                ...board.backlog.map(c => `${c.title} ${c.description}`),
                ...board.in_progress.map(c => `${c.title} ${c.description}`),
                ...board.done.map(c => `${c.title} ${c.description}`),
              ].join(" ").toLowerCase();

              return {
                id: p.id,
                name: p.name,
                textBlob,
                decisions,
                docs,
                techKeywords: extractTechKeywords(textBlob),
              };
            })
          );

          const connections: Array<{
            type: "shared_pattern" | "contradiction" | "reusable_work";
            projects: string[];
            description: string;
          }> = [];

          // Find shared technical patterns
          for (let i = 0; i < projectData.length; i++) {
            for (let j = i + 1; j < projectData.length; j++) {
              const a = projectData[i];
              const b = projectData[j];

              // Shared keywords
              const shared = a.techKeywords.filter(k => b.techKeywords.includes(k));
              if (shared.length >= 2) {
                connections.push({
                  type: "shared_pattern",
                  projects: [a.name, b.name],
                  description: `Both use: ${shared.slice(0, 4).join(", ")}`,
                });
              }

              // Check for contradictory decisions (same topic, different choices)
              for (const decA of a.decisions) {
                for (const decB of b.decisions) {
                  const titleOverlap = decA.title.toLowerCase().split(/\s+/)
                    .filter(w => w.length > 3)
                    .some(w => decB.title.toLowerCase().includes(w));
                  if (titleOverlap && decA.title !== decB.title) {
                    connections.push({
                      type: "contradiction",
                      projects: [a.name, b.name],
                      description: `"${decA.title}" vs "${decB.title}" — different approaches?`,
                    });
                  }
                }
              }

              // Reusable work (shared doc types)
              const aDocTypes = new Set(a.docs.map(d => d.type));
              const bDocTypes = new Set(b.docs.map(d => d.type));
              if (aDocTypes.has("reference") && bDocTypes.has("reference")) {
                const aRefTitles = a.docs.filter(d => d.type === "reference").map(d => d.title.toLowerCase());
                const bRefTitles = b.docs.filter(d => d.type === "reference").map(d => d.title.toLowerCase());
                for (const title of aRefTitles) {
                  const words = title.split(/\s+/).filter(w => w.length > 3);
                  for (const bTitle of bRefTitles) {
                    if (words.some(w => bTitle.includes(w))) {
                      connections.push({
                        type: "reusable_work",
                        projects: [a.name, b.name],
                        description: `Shared reference material may apply to both`,
                      });
                    }
                  }
                }
              }
            }
          }

          // Deduplicate by description
          const seen = new Set<string>();
          const unique = connections.filter(c => {
            if (seen.has(c.description)) return false;
            seen.add(c.description);
            return true;
          });

          sendJson(res, 200, { ok: true, data: unique.slice(0, 10) });
          return;
        }

        // Fragment stitcher — POST /api/fragments
        // Accepts a text fragment and auto-assigns it to the best-matching project
        if (path === "/api/fragments" && method === "POST") {
          const body = JSON.parse(await readBody(req)) as { content: string; projectId?: string };
          const { content, projectId } = body;
          if (!content) {
            sendJson(res, 400, { ok: false, error: "content required" });
            return;
          }

          let targetProjectId = projectId;
          let targetProjectName = "";

          if (!targetProjectId) {
            // Auto-detect project by keyword matching
            const projects = await Effect.runPromise(db.getProjects());
            const activeProjects = projects.filter(p => p.status === "active");
            const contentLower = content.toLowerCase();

            let bestMatch: { id: string; name: string; score: number } | null = null;
            for (const p of activeProjects) {
              let score = 0;
              // Name match is strongest signal
              if (contentLower.includes(p.name.toLowerCase())) score += 10;
              // Check description keywords
              if (p.description) {
                const descWords = p.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                score += descWords.filter(w => contentLower.includes(w)).length;
              }
              if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = { id: p.id, name: p.name, score };
              }
            }

            if (bestMatch) {
              targetProjectId = bestMatch.id;
              targetProjectName = bestMatch.name;
            }
          }

          // Save fragment as a message in the project thread (or general)
          await Effect.runPromise(
            db.saveMessage({
              id: crypto.randomUUID(),
              projectId: targetProjectId ?? null,
              conversationId: undefined,
              role: "user",
              content: `[Fragment] ${content}`,
              timestamp: Date.now(),
            })
          );

          // If project is identified, also create a backlog card
          if (targetProjectId) {
            try {
              await Effect.runPromise(
                kanban.createCard(targetProjectId, `Fragment: ${content.slice(0, 80)}`, content, "backlog")
              );
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
          });
          return;
        }

        // Agent orchestration — POST /api/agents/spawn
        if (path === "/api/agents/spawn" && method === "POST") {
          const body = JSON.parse(await readBody(req));
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
          );
          if ("error" in result) {
            sendJson(res, 400, { ok: false, error: result.error });
          } else {
            sendJson(res, 200, { ok: true, data: { cardId: result.cardId, agent: result.agent, branchName: result.branchName } });
          }
          return;
        }

        // Agent orchestration — DELETE /api/agents/:cardId
        const agentStopMatch = path.match(/^\/api\/agents\/([^/]+)$/);
        if (agentStopMatch && method === "DELETE") {
          await Effect.runPromise(
            agentOrchestrator.stopAgent(agentStopMatch[1]).pipe(
              Effect.catchAll((err) =>
                Effect.logError(`Failed to stop agent: ${err.message}`)
              )
            )
          );
          sendJson(res, 200, { ok: true });
          return;
        }

        // Agent orchestration — GET /api/agents
        if (path === "/api/agents" && method === "GET") {
          const agents = await Effect.runPromise(agentOrchestrator.getRunningAgents());
          sendJson(res, 200, { ok: true, data: agents });
          return;
        }

        // Agent logs — GET /api/agents/:cardId/logs
        const agentLogsMatch = path.match(/^\/api\/agents\/([^/]+)\/logs$/);
        if (agentLogsMatch && method === "GET") {
          const limit = parseInt(url.searchParams.get("limit") || "100");
          const logs = await Effect.runPromise(agentOrchestrator.getAgentLogs(agentLogsMatch[1], limit));
          sendJson(res, 200, { ok: true, data: logs });
          return;
        }

        // ── Steering corrections ──

        // List corrections — GET /api/steering
        if (path === "/api/steering" && method === "GET") {
          const domain = url.searchParams.get("domain") as CorrectionDomain | null
          const projectId = url.searchParams.get("projectId")
          const includeInactive = url.searchParams.get("includeInactive") === "true"
          const corrections = await Effect.runPromise(
            steeringEngine.query({
              domain: domain ?? undefined,
              projectId: projectId ?? undefined,
              activeOnly: !includeInactive,
            })
          )
          sendJson(res, 200, { ok: true, data: corrections })
          return
        }

        // Add correction — POST /api/steering
        if (path === "/api/steering" && method === "POST") {
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
          return
        }

        // Deactivate correction — POST /api/steering/:id/deactivate
        const deactivateMatch = path.match(/^\/api\/steering\/([^/]+)\/deactivate$/)
        if (deactivateMatch && method === "POST") {
          await Effect.runPromise(steeringEngine.deactivate(deactivateMatch[1]))
          sendJson(res, 200, { ok: true })
          return
        }

        // Reactivate correction — POST /api/steering/:id/reactivate
        const reactivateMatch = path.match(/^\/api\/steering\/([^/]+)\/reactivate$/)
        if (reactivateMatch && method === "POST") {
          await Effect.runPromise(steeringEngine.reactivate(reactivateMatch[1]))
          sendJson(res, 200, { ok: true })
          return
        }

        // Delete correction — DELETE /api/steering/:id
        const deleteCorrectionMatch = path.match(/^\/api\/steering\/([^/]+)$/)
        if (deleteCorrectionMatch && method === "DELETE") {
          await Effect.runPromise(steeringEngine.remove(deleteCorrectionMatch[1]))
          sendJson(res, 200, { ok: true })
          return
        }

        // Build prompt block — GET /api/steering/prompt
        if (path === "/api/steering/prompt" && method === "GET") {
          const projectId = url.searchParams.get("projectId") ?? undefined
          const block = await Effect.runPromise(steeringEngine.buildPromptBlock(projectId))
          sendJson(res, 200, { ok: true, data: block })
          return
        }

        sendJson(res, 404, { ok: false, error: "Not found" });
      } catch (err) {
        console.error("API error:", err);
        sendJson(res, 500, { ok: false, error: "Internal server error" });
      }
    };

    // Register finalizer
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (wss) {
          wss.clients?.forEach((client: any) => client.close());
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
            const cert = readFileSync(tlsCertPath);
            const key = readFileSync(tlsKeyPath);
            httpServer = createHttpsServer({ cert, key }, handleRequest);
          } else {
            httpServer = createServer(handleRequest);
          }
          wss = new WebSocketServer({ server: httpServer, path: "/ws" });

          // Wire agent broadcast to WebSocket clients
          setAgentBroadcast((message) => {
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
          const parseActions = (text: string): WorkspaceAction[] => {
            const actions: WorkspaceAction[] = [];
            const regex = /:::action\s*\n([\s\S]*?)\n:::/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
              try {
                const action = JSON.parse(match[1].trim()) as WorkspaceAction;
                if (action.type) actions.push(action);
              } catch {
                // Ignore malformed action blocks
              }
            }
            return actions;
          };

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

          const heartbeatTimer = setInterval(() => {
            wss.clients?.forEach((client: any) => {
              if (client._missedPings >= HEARTBEAT_MISSED_LIMIT) {
                console.log("[AppServer] Terminating dead WebSocket client (missed", client._missedPings, "pings)");
                client.terminate();
                return;
              }
              client._missedPings = (client._missedPings || 0) + 1;
              if (client.readyState === 1) { // WebSocket.OPEN
                client.send(JSON.stringify({ type: "ping" }));
              }
            });
          }, HEARTBEAT_INTERVAL);

          // Clean up heartbeat on server close
          wss.on("close", () => {
            clearInterval(heartbeatTimer);
          });

          // WebSocket connection handler
          wss.on("connection", (ws: any, req: IncomingMessage) => {
            // Auth check for WebSocket
            if (!authenticate(req)) {
              ws.close(4001, "Unauthorized");
              return;
            }

            const connectedAt = Date.now();
            ws._missedPings = 0;
            console.log("[AppServer] WebSocket client connected");

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
              const duration = Math.round((Date.now() - connectedAt) / 1000);
              console.log(`[AppServer] WebSocket client disconnected after ${duration}s`);
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
          if (wss) {
            wss.clients?.forEach((client: any) => client.close());
            wss.close();
          }
          if (httpServer) {
            httpServer.close();
          }
        }),
    };
  })
);
