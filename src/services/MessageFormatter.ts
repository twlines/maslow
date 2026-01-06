/**
 * Message Formatter Service
 *
 * Formats Claude responses and tool calls for Telegram display.
 */

import { Context, Effect, Layer } from "effect";
import type { ToolCall, ClaudeEvent } from "./ClaudeSession.js";

export interface MessageFormatterService {
  /**
   * Format a tool call for display
   */
  formatToolCall(toolCall: ToolCall): string;

  /**
   * Format a tool result for display
   */
  formatToolResult(toolCall: ToolCall): string;

  /**
   * Format usage stats
   */
  formatUsage(usage: NonNullable<ClaudeEvent["usage"]>, cost?: number): string;

  /**
   * Format context warning
   */
  formatContextWarning(usagePercent: number): string;

  /**
   * Format handoff message
   */
  formatHandoff(summary: string): string;

  /**
   * Format error message
   */
  formatError(error: string): string;

  /**
   * Format service notification
   */
  formatNotification(type: "startup" | "shutdown" | "error", message?: string): string;
}

export class MessageFormatter extends Context.Tag("MessageFormatter")<
  MessageFormatter,
  MessageFormatterService
>() {}

const TOOL_EMOJIS: Record<string, string> = {
  Read: "📖",
  Write: "✏️",
  Edit: "📝",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔎",
  Task: "📋",
  TodoWrite: "✅",
  AskUserQuestion: "❓",
  NotebookEdit: "📓",
  default: "🔧",
};

const getToolEmoji = (toolName: string): string => {
  return TOOL_EMOJIS[toolName] || TOOL_EMOJIS.default;
};

const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
};

const formatToolInput = (input: Record<string, unknown>): string => {
  const lines: string[] = [];

  // Handle common tool parameters
  if (input.file_path) {
    lines.push(`   File: ${input.file_path}`);
  }
  if (input.command) {
    lines.push(`   Command: ${truncate(String(input.command), 100)}`);
  }
  if (input.pattern) {
    lines.push(`   Pattern: ${input.pattern}`);
  }
  if (input.path) {
    lines.push(`   Path: ${input.path}`);
  }
  if (input.query) {
    lines.push(`   Query: ${truncate(String(input.query), 100)}`);
  }
  if (input.url) {
    lines.push(`   URL: ${input.url}`);
  }
  if (input.prompt) {
    lines.push(`   Prompt: ${truncate(String(input.prompt), 80)}`);
  }

  // If no common parameters, show first few key-value pairs
  if (lines.length === 0) {
    const entries = Object.entries(input).slice(0, 3);
    for (const [key, value] of entries) {
      const valueStr = typeof value === "string" ? value : JSON.stringify(value);
      lines.push(`   ${key}: ${truncate(valueStr, 80)}`);
    }
  }

  return lines.join("\n");
};

export const MessageFormatterLive = Layer.succeed(
  MessageFormatter,
  {
    formatToolCall: (toolCall) => {
      const emoji = getToolEmoji(toolCall.name);
      const inputStr = formatToolInput(toolCall.input);
      return `${emoji} Tool: ${toolCall.name}\n${inputStr}`;
    },

    formatToolResult: (toolCall) => {
      const emoji = getToolEmoji(toolCall.name);
      const result = toolCall.result || "(no output)";

      // Extract useful info from result
      let resultSummary: string;
      if (result.includes("\n")) {
        const lines = result.split("\n");
        const lineCount = lines.length;
        const preview = lines.slice(0, 3).join("\n");
        resultSummary = `(${lineCount} lines)\n${truncate(preview, 200)}`;
      } else {
        resultSummary = truncate(result, 300);
      }

      return `${emoji} ${toolCall.name} result:\n   ${resultSummary}`;
    },

    formatUsage: (usage, cost) => {
      const contextPercent = Math.round(
        ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100
      );
      const lines = [
        `📊 Usage:`,
        `   Input: ${usage.inputTokens.toLocaleString()} tokens`,
        `   Output: ${usage.outputTokens.toLocaleString()} tokens`,
        `   Cache: ${usage.cacheReadTokens.toLocaleString()} read, ${usage.cacheWriteTokens.toLocaleString()} write`,
        `   Context: ~${contextPercent}%`,
      ];
      if (cost !== undefined) {
        lines.push(`   Cost: $${cost.toFixed(4)}`);
      }
      return lines.join("\n");
    },

    formatContextWarning: (usagePercent) => {
      return `⚠️ Context limit approaching (${usagePercent.toFixed(0)}% used).\n\nWould you like to start a continuation? I'll summarize our progress so we can continue in a fresh session.`;
    },

    formatHandoff: (summary) => {
      return `📋 **Session Handoff**\n\n${summary}\n\n---\n✅ Continuation ready. You can continue where you left off.`;
    },

    formatError: (error) => {
      return `❌ Error: ${error}`;
    },

    formatNotification: (type, message) => {
      switch (type) {
        case "startup":
          return `🟢 Telegram-Claude service started.\n${message || "Ready to receive messages."}`;
        case "shutdown":
          return `🔴 Telegram-Claude service stopping.\n${message || "Goodbye!"}`;
        case "error":
          return `⚠️ Service Error:\n${message || "An unexpected error occurred."}`;
      }
    },
  }
);
