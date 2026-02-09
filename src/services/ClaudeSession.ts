/**
 * Claude Session Service
 *
 * Manages Claude Code sessions via the CLI (uses OAuth authentication).
 */

import { Context, Effect, Layer, Stream } from "effect";
import { spawn } from "child_process";
import { ConfigService } from "./Config.js";
import { SoulLoader } from "./SoulLoader.js";
import { ClaudeMem } from "./ClaudeMem.js";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface ClaudeEvent {
  type: "text" | "tool_call" | "tool_result" | "result" | "error";
  sessionId?: string;
  content?: string;
  toolCall?: ToolCall;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    contextWindow: number;
  };
  cost?: number;
  error?: string;
}

export interface ClaudeSessionService {
  /**
   * Send a message to Claude and receive streaming events
   */
  sendMessage(options: {
    prompt: string;
    cwd: string;
    resumeSessionId?: string;
    images?: Array<{ data: Buffer; mediaType: string }>;
  }): Stream.Stream<ClaudeEvent, Error>;

  /**
   * Generate a handoff summary for session continuation
   */
  generateHandoff(options: {
    sessionId: string;
    cwd: string;
  }): Effect.Effect<string, Error>;
}

export class ClaudeSession extends Context.Tag("ClaudeSession")<
  ClaudeSession,
  ClaudeSessionService
>() {}

export const ClaudeSessionLive = Layer.effect(
  ClaudeSession,
  Effect.gen(function* () {
    const _config = yield* ConfigService;
    const soulLoader = yield* SoulLoader;
    const claudeMem = yield* ClaudeMem;

    return {
      sendMessage: (options) =>
        Stream.async<ClaudeEvent, Error>((emit) => {
          let childProcess: ReturnType<typeof spawn> | null = null;

          (async () => {
            try {
              // Inject soul into prompt (only on first message, not resume)
              let prompt = options.prompt;
              if (!options.resumeSessionId) {
                const soul = await Effect.runPromise(
                  soulLoader.getSoul().pipe(Effect.catchAll(() => Effect.succeed("")))
                );
                if (soul) {
                  prompt = `${soul}\n\n---\n\nUser message:\n${prompt}`;
                }
              }

              // Query Claude-Mem for relevant memories (disabled if not configured)
              const memories = await Effect.runPromise(
                claudeMem.query(prompt).pipe(Effect.catchAll(() => Effect.succeed("")))
              );
              if (memories) {
                prompt = `Relevant memories:\n${memories}\n\n---\n\n${prompt}`;
              }

              // Handle images by noting them in prompt
              if (options.images && options.images.length > 0) {
                prompt = `[Image attached]\n\n${prompt}`;
              }

              // Build CLI arguments — DO NOT CHANGE (see CLAUDE.md § Claude CLI Integration)
              const args = [
                "-p",
                "--verbose",
                "--output-format", "stream-json",
                "--permission-mode", "bypassPermissions",
                "--max-turns", "50"
              ];

              if (options.resumeSessionId) {
                args.push("--resume", options.resumeSessionId);
              }

              args.push(prompt);

              // Spawn claude CLI — strip ANTHROPIC_API_KEY so CLI uses OAuth
              const claudeEnv = { ...process.env };
              delete claudeEnv.ANTHROPIC_API_KEY;
              childProcess = spawn("claude", args, {
                stdio: ["pipe", "pipe", "pipe"],
                shell: false,
                cwd: options.cwd,
                env: claudeEnv,
              });
              childProcess.stdin?.end(); // Claude CLI blocks on open stdin pipe

              let currentSessionId: string | undefined;
              const pendingToolCalls = new Map<string, ToolCall>();
              let assistantResponse = "";
              let buffer = "";

              // Process stdout (JSONL stream)
              childProcess.stdout?.on("data", (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                  if (!line.trim()) continue;

                  try {
                    const message = JSON.parse(line);

                    switch (message.type) {
                      case "system":
                        if (message.subtype === "init" && typeof message.session_id === "string") {
                          currentSessionId = message.session_id;
                          
                          // Initialize Claude-Mem session
                          // We use the Claude Code session ID as the contentSessionId
                          const project = options.cwd.split("/").pop() || "unknown";
                          Effect.runPromise(
                            claudeMem.initSession(message.session_id, project, options.prompt)
                              .pipe(Effect.catchAll((e) => Effect.logError("Failed to init memory session", e)))
                          );

                          emit.single({
                            type: "text",
                            sessionId: currentSessionId,
                            content: "",
                          });
                        }
                        break;

                      case "assistant":
                        // Process content blocks
                        for (const block of message.message?.content || []) {
                          if (block.type === "text") {
                            assistantResponse += block.text;
                            emit.single({
                              type: "text",
                              sessionId: currentSessionId,
                              content: block.text,
                            });
                          } else if (block.type === "tool_use") {
                            const toolCall: ToolCall = {
                              name: block.name,
                              input: block.input as Record<string, unknown>,
                            };
                            pendingToolCalls.set(block.id, toolCall);
                            emit.single({
                              type: "tool_call",
                              sessionId: currentSessionId,
                              toolCall,
                            });
                          }
                        }
                        break;

                      case "user":
                        // Tool results come back as user messages
                        for (const block of message.message?.content || []) {
                          if (block.type === "tool_result") {
                            const toolCall = pendingToolCalls.get(block.tool_use_id);
                            if (toolCall) {
                              const resultText =
                                typeof block.content === "string"
                                  ? block.content
                                  : Array.isArray(block.content)
                                    ? block.content
                                        .filter((c: any) => c.type === "text")
                                        .map((c: any) => c.text)
                                        .join("\n")
                                    : "";

                              emit.single({
                                type: "tool_result",
                                sessionId: currentSessionId,
                                toolCall: { ...toolCall, result: resultText },
                              });
                              pendingToolCalls.delete(block.tool_use_id);
                            }
                          }
                        }
                        break;

                      case "result": {
                        // Calculate context usage from the result
                        const modelUsage = Object.values(message.modelUsage || {})[0] as any;

                        emit.single({
                          type: "result",
                          sessionId: currentSessionId,
                          usage: modelUsage
                            ? {
                                inputTokens: modelUsage.inputTokens || 0,
                                outputTokens: modelUsage.outputTokens || 0,
                                cacheReadTokens: modelUsage.cacheReadInputTokens || 0,
                                cacheWriteTokens: modelUsage.cacheCreationInputTokens || 0,
                                contextWindow: modelUsage.contextWindow || 200000,
                              }
                            : undefined,
                          cost: message.total_cost_usd,
                        });
                        break;
                      }
                    }
                  } catch (_parseError) {
                    // Ignore malformed JSON lines (might be stderr mixed in)
                    console.warn("Failed to parse JSONL:", line.substring(0, 100));
                  }
                }
              });

              // Process stderr (errors)
              childProcess.stderr?.on("data", (chunk: Buffer) => {
                const errorText = chunk.toString();
                console.error("Claude CLI stderr:", errorText);
              });

              // Handle process exit
              childProcess.on("close", async (code) => {
                if (code !== 0 && code !== null) {
                  emit.single({
                    type: "error",
                    error: `Claude Code process exited with code ${code}`,
                  });
                }

                // Store conversation summary in Claude-Mem
                if (assistantResponse && currentSessionId) {
                  await Effect.runPromise(
                    claudeMem.summarize(currentSessionId, assistantResponse)
                      .pipe(Effect.catchAll(() => Effect.void))
                  );
                }

                emit.end();
              });

              childProcess.on("error", (error) => {
                emit.single({
                  type: "error",
                  error: `Failed to spawn claude CLI: ${error.message}`,
                });
                emit.end();
              });
            } catch (error) {
              emit.single({
                type: "error",
                error: error instanceof Error ? error.message : String(error),
              });
              emit.end();
            }
          })();

          // Return cleanup function
          return Effect.sync(() => {
            if (childProcess) {
              childProcess.kill();
            }
          });
        }),

      generateHandoff: (options) =>
        Effect.tryPromise({
          try: async () => {
            return new Promise<string>((resolve, reject) => {
              // DO NOT CHANGE these args (see CLAUDE.md § Claude CLI Integration)
              const args = [
                "-p",
                "--verbose",
                "--output-format", "stream-json",
                "--resume", options.sessionId,
                "--permission-mode", "bypassPermissions",
                "--max-turns", "1",
                `Please provide a comprehensive handoff summary of our current session. Include:
1. What we were working on
2. Key decisions made
3. Current state of the work
4. Immediate next steps
5. Any important context the next session should know

Format this as a clear, structured summary that can be used to continue this work in a new session.`
              ];

              const handoffEnv = { ...process.env };
              delete handoffEnv.ANTHROPIC_API_KEY;
              const childProcess = spawn("claude", args, {
                stdio: ["pipe", "pipe", "pipe"],
                shell: false,
                cwd: options.cwd,
                env: handoffEnv,
              });
              childProcess.stdin?.end();

              let summary = "";
              let buffer = "";

              childProcess.stdout?.on("data", (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                  if (!line.trim()) continue;

                  try {
                    const message = JSON.parse(line);
                    if (message.type === "assistant") {
                      for (const block of message.message?.content || []) {
                        if (block.type === "text") {
                          summary += block.text;
                        }
                      }
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              });

              childProcess.on("close", (code) => {
                if (code === 0) {
                  resolve(summary || "No summary generated.");
                } else {
                  reject(new Error(`Handoff generation failed with code ${code}`));
                }
              });

              childProcess.on("error", (error) => {
                reject(error);
              });
            });
          },
          catch: (error) =>
            new Error(
              `Failed to generate handoff: ${error instanceof Error ? error.message : error}`
            ),
        }),
    };
  })
);
