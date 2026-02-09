/**
 * Unit Tests for MessageFormatter Service
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { MessageFormatter, MessageFormatterLive } from "../../services/MessageFormatter.js";
import type { ClaudeEvent } from "../../services/ClaudeSession.js";

// Helper to run effects with MessageFormatter layer
const runWithFormatter = <A>(
  effect: Effect.Effect<A, never, MessageFormatter>
): Promise<A> => {
  return Effect.runPromise(Effect.provide(effect, MessageFormatterLive));
};

describe("MessageFormatter", () => {
  describe("formatToolCall", () => {
    it("should format a Read tool call with emoji", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolCall({
            name: "Read",
            input: { file_path: "/src/index.ts" },
          });
        })
      );

      expect(result).toContain("Read");
      expect(result).toContain("/src/index.ts");
    });

    it("should format a Bash tool call with command", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolCall({
            name: "Bash",
            input: { command: "npm install" },
          });
        })
      );

      expect(result).toContain("Bash");
      expect(result).toContain("npm install");
    });

    it("should truncate long commands", async () => {
      const longCommand = "a".repeat(200);
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolCall({
            name: "Bash",
            input: { command: longCommand },
          });
        })
      );

      expect(result.length).toBeLessThan(longCommand.length + 50);
      expect(result).toContain("...");
    });

    it("should use default emoji for unknown tools", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolCall({
            name: "UnknownTool",
            input: { foo: "bar" },
          });
        })
      );

      expect(result).toContain("UnknownTool");
    });

    it("should format Glob tool with pattern", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolCall({
            name: "Glob",
            input: { pattern: "**/*.ts", path: "/src" },
          });
        })
      );

      expect(result).toContain("Glob");
      expect(result).toContain("**/*.ts");
    });
  });

  describe("formatToolResult", () => {
    it("should format a tool result with content", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolResult({
            name: "Read",
            input: { file_path: "/src/index.ts" },
            result: "const x = 1;",
          });
        })
      );

      expect(result).toContain("Read");
      expect(result).toContain("result");
    });

    it("should show line count for multiline results", async () => {
      const multilineResult = "line1\nline2\nline3\nline4\nline5";
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolResult({
            name: "Read",
            input: { file_path: "/src/index.ts" },
            result: multilineResult,
          });
        })
      );

      expect(result).toContain("5 lines");
    });

    it("should handle empty results", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolResult({
            name: "Bash",
            input: { command: "true" },
            result: undefined,
          });
        })
      );

      expect(result).toContain("no output");
    });

    it("should truncate very long single-line results", async () => {
      const longResult = "x".repeat(500);
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatToolResult({
            name: "Bash",
            input: { command: "echo" },
            result: longResult,
          });
        })
      );

      expect(result.length).toBeLessThan(longResult.length);
      expect(result).toContain("...");
    });
  });

  describe("formatUsage", () => {
    it("should format usage statistics", async () => {
      const usage: NonNullable<ClaudeEvent["usage"]> = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        contextWindow: 100000,
      };

      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatUsage(usage);
        })
      );

      expect(result).toContain("Usage");
      expect(result).toContain("1,000");
      expect(result).toContain("500");
      expect(result).toContain("Cache");
    });

    it("should include cost when provided", async () => {
      const usage: NonNullable<ClaudeEvent["usage"]> = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextWindow: 100000,
      };

      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatUsage(usage, 0.0234);
        })
      );

      expect(result).toContain("$0.0234");
    });

    it("should calculate context percentage", async () => {
      const usage: NonNullable<ClaudeEvent["usage"]> = {
        inputTokens: 40000,
        outputTokens: 10000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextWindow: 100000,
      };

      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatUsage(usage);
        })
      );

      expect(result).toContain("50%");
    });
  });

  describe("formatContextWarning", () => {
    it("should format context warning with percentage", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatContextWarning(85);
        })
      );

      expect(result).toContain("85%");
      expect(result).toContain("Context");
      expect(result).toContain("continuation");
    });
  });

  describe("formatHandoff", () => {
    it("should format handoff message with summary", async () => {
      const summary = "We worked on implementing tests.";
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatHandoff(summary);
        })
      );

      expect(result).toContain("Session Handoff");
      expect(result).toContain(summary);
      expect(result).toContain("Continuation ready");
    });
  });

  describe("formatError", () => {
    it("should format error message", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatError("Connection failed");
        })
      );

      expect(result).toContain("Error");
      expect(result).toContain("Connection failed");
    });
  });

  describe("formatNotification", () => {
    it("should format startup notification", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatNotification("startup");
        })
      );

      expect(result).toContain("started");
    });

    it("should format shutdown notification", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatNotification("shutdown");
        })
      );

      expect(result).toContain("stopping");
    });

    it("should format error notification with message", async () => {
      const result = await runWithFormatter(
        Effect.gen(function* () {
          const formatter = yield* MessageFormatter;
          return formatter.formatNotification("error", "Database connection lost");
        })
      );

      expect(result).toContain("Error");
      expect(result).toContain("Database connection lost");
    });
  });
});
