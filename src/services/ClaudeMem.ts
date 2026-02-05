/**
 * Claude-Mem Integration Service
 *
 * Handles querying and storing memories via Claude-Mem API.
 */

import { Context, Effect, Layer } from "effect";
import { ConfigService } from "./Config.js";

export interface ClaudeMemService {
  /**
   * Initialize a session in Claude-Mem
   */
  initSession(contentSessionId: string, project: string, prompt: string): Effect.Effect<void, Error>;

  /**
   * Query memories related to a prompt
   */
  query(query: string): Effect.Effect<string, Error>;

  /**
   * Store a new memory
   * @deprecated Use summarize instead
   */
  store(content: string): Effect.Effect<void, Error>;

  /**
   * Summarize session and store in Claude-Mem
   */
  summarize(contentSessionId: string, lastAssistantMessage: string): Effect.Effect<void, Error>;
}

export class ClaudeMem extends Context.Tag("ClaudeMem")<
  ClaudeMem,
  ClaudeMemService
>() {}

export const ClaudeMemLive = Layer.effect(
  ClaudeMem,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const claudeMemUrl = config.claudeMem?.url;

    const isEnabled = !!claudeMemUrl;

    return {
      initSession: (
        contentSessionId: string,
        project: string,
        prompt: string,
      ) =>
        Effect.tryPromise({
          try: async () => {
            if (!isEnabled) return;

            const response = await fetch(`${claudeMemUrl}/api/sessions/init`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contentSessionId, project, prompt }),
            });

            if (!response.ok) {
              throw new Error(`Claude-Mem init failed: ${response.statusText}`);
            }
          },
          catch: (error) => new Error(`Failed to init session: ${error}`),
        }),

      query: (query: string) =>
        Effect.tryPromise({
          try: async () => {
            if (!isEnabled) return "";

            const response = await fetch(
              `${claudeMemUrl}/api/search?query=${encodeURIComponent(query)}&limit=3`,
              {
                method: "GET",
                headers: { "Content-Type": "application/json" },
              },
            );

            if (!response.ok) {
              throw new Error(
                `Claude-Mem query failed: ${response.statusText}`,
              );
            }

            const data = (await response.json()) as {
              content?: Array<{ text: string }>;
            };
            // Flatten results
            return data.content?.map((c) => c.text).join("\n\n") || "";
          },
          catch: (error) => new Error(`Failed to query Claude-Mem: ${error}`),
        }),

      store: (content: string) =>
        Effect.fail(new Error("Deprecated: Use summarize() instead")),

      summarize: (contentSessionId: string, lastAssistantMessage: string) =>
        Effect.tryPromise({
          try: async () => {
            if (!isEnabled) return;

            const response = await fetch(
              `${claudeMemUrl}/api/sessions/summarize`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contentSessionId,
                  last_assistant_message: lastAssistantMessage,
                }),
              },
            );

            if (!response.ok) {
              throw new Error(
                `Claude-Mem summarize failed: ${response.statusText}`,
              );
            }
          },
          catch: (error) => new Error(`Failed to summarize: ${error}`),
        }),
    };
  }),
);
