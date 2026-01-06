/**
 * Claude Session Service
 *
 * Manages Claude Code sessions via the Agent SDK.
 */

import { Context, Effect, Layer, Stream } from "effect";
import { query } from "@anthropic-ai/claude-code";
import { ConfigService } from "./Config.js";

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
    const config = yield* ConfigService;

    return {
      sendMessage: (options) =>
        Stream.async<ClaudeEvent, Error>((emit) => {
          const abortController = new AbortController();

          (async () => {
            try {
              const queryOptions: Parameters<typeof query>[0]["options"] = {
                cwd: options.cwd,
                abortController,
                permissionMode: "bypassPermissions" as const,
                maxTurns: 50,
              };

              if (options.resumeSessionId) {
                queryOptions.resume = options.resumeSessionId;
              }

              // Handle images by appending to prompt
              let prompt = options.prompt;
              if (options.images && options.images.length > 0) {
                // Claude Code SDK expects images in the prompt via special format
                // For now, we'll note that images are attached
                prompt = `[Image attached]\n\n${prompt}`;
              }

              const response = query({ prompt, options: queryOptions });

              let currentSessionId: string | undefined;
              let pendingToolCalls = new Map<string, ToolCall>();

              for await (const message of response) {
                switch (message.type) {
                  case "system":
                    if (message.subtype === "init") {
                      currentSessionId = message.session_id;
                      emit.single({
                        type: "text",
                        sessionId: currentSessionId,
                        content: "",
                      });
                    }
                    break;

                  case "assistant":
                    // Process content blocks
                    for (const block of message.message.content) {
                      if (block.type === "text") {
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
                    for (const block of message.message.content) {
                      if (block.type === "tool_result") {
                        const toolCall = pendingToolCalls.get(block.tool_use_id);
                        if (toolCall) {
                          const resultText =
                            typeof block.content === "string"
                              ? block.content
                              : Array.isArray(block.content)
                                ? (block.content as Array<{ type: string; text?: string }>)
                                    .filter((c: { type: string; text?: string }): c is { type: "text"; text: string } => c.type === "text")
                                    .map((c: { type: "text"; text: string }) => c.text)
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

                  case "result":
                    // Calculate context usage from the result
                    const modelUsage = Object.values(message.modelUsage)[0];

                    emit.single({
                      type: "result",
                      sessionId: currentSessionId,
                      usage: modelUsage
                        ? {
                            inputTokens: modelUsage.inputTokens,
                            outputTokens: modelUsage.outputTokens,
                            cacheReadTokens: modelUsage.cacheReadInputTokens,
                            cacheWriteTokens: modelUsage.cacheCreationInputTokens,
                            contextWindow: modelUsage.contextWindow,
                          }
                        : undefined,
                      cost: message.total_cost_usd,
                    });
                    break;
                }
              }

              emit.end();
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
            abortController.abort();
          });
        }),

      generateHandoff: (options) =>
        Effect.tryPromise({
          try: async () => {
            const response = query({
              prompt: `Please provide a comprehensive handoff summary of our current session. Include:
1. What we were working on
2. Key decisions made
3. Current state of the work
4. Immediate next steps
5. Any important context the next session should know

Format this as a clear, structured summary that can be used to continue this work in a new session.`,
              options: {
                cwd: options.cwd,
                resume: options.sessionId,
                maxTurns: 1,
                permissionMode: "bypassPermissions" as const,
              },
            });

            let summary = "";
            for await (const message of response) {
              if (message.type === "assistant") {
                for (const block of message.message.content) {
                  if (block.type === "text") {
                    summary += block.text;
                  }
                }
              }
            }

            return summary || "No summary generated.";
          },
          catch: (error) =>
            new Error(
              `Failed to generate handoff: ${error instanceof Error ? error.message : error}`
            ),
        }),
    };
  })
);
