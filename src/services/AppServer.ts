/**
 * App Server Service
 *
 * HTTP/WS API server for the Maslow web and mobile apps.
 * Runs alongside the Telegram bot on a separate port.
 */

import { Context, Effect, Layer, Stream } from "effect";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { ConfigService } from "./Config.js";
import { ClaudeSession } from "./ClaudeSession.js";
import { AppPersistence, type AppConversation } from "./AppPersistence.js";
import { Voice } from "./Voice.js";
import { Kanban } from "./Kanban.js";
import { ThinkingPartner } from "./ThinkingPartner.js";

// Simple token auth for single user
const AUTH_TOKEN_HEADER = "authorization";

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

    const port = config.appServer?.port ?? 3117;
    const authToken = config.appServer?.authToken ?? "";

    let httpServer: ReturnType<typeof createServer> | null = null;
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

          httpServer = createServer(handleRequest);
          wss = new WebSocketServer({ server: httpServer, path: "/ws" });

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

            // Inject project context if scoped to a project
            if (projectId) {
              try {
                const context = await Effect.runPromise(thinkingPartner.getProjectContext(projectId));
                if (context) {
                  prompt = `${context}\n---\n\nUser message:\n${userMessage}`;
                }
              } catch { /* ignore context loading failures */ }
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

          // WebSocket connection handler
          wss.on("connection", (ws: any, req: IncomingMessage) => {
            // Auth check for WebSocket
            if (!authenticate(req)) {
              ws.close(4001, "Unauthorized");
              return;
            }

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

                            // Save assistant message
                            const assistantMsg = {
                              id: responseId,
                              projectId,
                              conversationId: conversation.id,
                              role: "assistant" as const,
                              content: fullResponse,
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

                            const assistantMsg = {
                              id: responseId,
                              projectId,
                              conversationId: conversation.id,
                              role: "assistant" as const,
                              content: fullResponse,
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

                            // Synthesize voice response
                            ws.send(JSON.stringify({ type: "presence", state: "speaking" }));
                            Effect.runPromise(voice.synthesize(fullResponse)).then((audio) => {
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
              console.log("[AppServer] WebSocket client disconnected");
            });
          });

          // Start listening
          yield* Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                httpServer!.listen(port, () => {
                  console.log(`[AppServer] HTTP/WS server listening on port ${port}`);
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
