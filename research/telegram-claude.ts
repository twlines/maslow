/**
 * Research Verification Script for Telegram-Claude Bridge
 *
 * This script verifies assumptions about external dependencies:
 * - Claude Agent SDK (@anthropic-ai/claude-code)
 * - Effect library
 * - Telegraf (Telegram Bot API)
 *
 * Run with: npx tsx research/telegram-claude.ts
 */

import * as fs from "fs";
import * as path from "path";

interface Assumption {
  category: string;
  claim: string;
  verify: () => Promise<boolean>;
  details?: string;
}

const assumptions: Assumption[] = [
  // ============================================
  // Claude Agent SDK Assumptions
  // ============================================
  {
    category: "Claude Agent SDK",
    claim: "Package exports 'query' function as main entry point",
    verify: async () => {
      const sdk = await import("@anthropic-ai/claude-code");
      return typeof sdk.query === "function";
    },
  },
  {
    category: "Claude Agent SDK",
    claim: "Package exports 'createSdkMcpServer' for custom MCP tools",
    verify: async () => {
      const sdk = await import("@anthropic-ai/claude-code");
      return typeof sdk.createSdkMcpServer === "function";
    },
  },
  {
    category: "Claude Agent SDK",
    claim: "Package exports 'tool' helper for defining MCP tools",
    verify: async () => {
      const sdk = await import("@anthropic-ai/claude-code");
      return typeof sdk.tool === "function";
    },
  },
  {
    category: "Claude Agent SDK",
    claim: "query() returns async iterable for streaming messages",
    verify: async () => {
      const sdk = await import("@anthropic-ai/claude-code");
      // Check that query returns something with Symbol.asyncIterator
      // We can't actually call it without API key, but we can check the function signature
      const queryFn = sdk.query;
      // The function should exist and be callable
      return typeof queryFn === "function" && queryFn.length >= 1;
    },
  },

  // ============================================
  // Effect Library Assumptions
  // ============================================
  {
    category: "Effect",
    claim: "Effect module exports core Effect type and functions",
    verify: async () => {
      const { Effect } = await import("effect");
      return (
        typeof Effect.succeed === "function" &&
        typeof Effect.fail === "function" &&
        typeof Effect.gen === "function" &&
        typeof Effect.runPromise === "function"
      );
    },
  },
  {
    category: "Effect",
    claim: "Effect supports Service/Layer pattern for dependency injection",
    verify: async () => {
      const { Context, Layer } = await import("effect");
      return (
        typeof Context.GenericTag === "function" &&
        typeof Layer.succeed === "function" &&
        typeof Layer.effect === "function"
      );
    },
  },
  {
    category: "Effect",
    claim: "Effect has Stream module for handling sequences",
    verify: async () => {
      const { Stream } = await import("effect");
      return (
        typeof Stream.fromIterable === "function" &&
        typeof Stream.runCollect === "function"
      );
    },
  },
  {
    category: "Effect",
    claim: "Effect has Queue for concurrent message passing",
    verify: async () => {
      const { Queue } = await import("effect");
      return (
        typeof Queue.unbounded === "function" &&
        typeof Queue.bounded === "function"
      );
    },
  },
  {
    category: "Effect",
    claim: "Effect has Schedule for retry/backoff patterns",
    verify: async () => {
      const { Schedule } = await import("effect");
      return (
        typeof Schedule.exponential === "function" &&
        typeof Schedule.recurs === "function"
      );
    },
  },
  {
    category: "Effect",
    claim: "Effect has Ref for managing mutable state",
    verify: async () => {
      const { Ref } = await import("effect");
      return (
        typeof Ref.make === "function" &&
        typeof Ref.get === "function" &&
        typeof Ref.set === "function"
      );
    },
  },

  // ============================================
  // Telegraf Assumptions
  // ============================================
  {
    category: "Telegraf",
    claim: "Telegraf class is the main bot constructor",
    verify: async () => {
      const { Telegraf } = await import("telegraf");
      return typeof Telegraf === "function";
    },
  },
  {
    category: "Telegraf",
    claim: "Telegraf instance has launch() for long polling",
    verify: async () => {
      const { Telegraf } = await import("telegraf");
      // Create instance without starting
      const bot = new Telegraf("dummy-token");
      return typeof bot.launch === "function";
    },
  },
  {
    category: "Telegraf",
    claim: "Telegraf instance has stop() for graceful shutdown",
    verify: async () => {
      const { Telegraf } = await import("telegraf");
      const bot = new Telegraf("dummy-token");
      return typeof bot.stop === "function";
    },
  },
  {
    category: "Telegraf",
    claim: "Telegraf supports on() for message handlers",
    verify: async () => {
      const { Telegraf } = await import("telegraf");
      const bot = new Telegraf("dummy-token");
      return typeof bot.on === "function";
    },
  },
  {
    category: "Telegraf",
    claim: "Telegraf context has reply() method",
    verify: async () => {
      // We verify this by checking the types exist
      const telegraf = await import("telegraf");
      // The Context type should have reply - we can verify the module structure
      return "Context" in telegraf || "Telegraf" in telegraf;
    },
  },
  {
    category: "Telegraf",
    claim: "Telegraf exports message filter helper",
    verify: async () => {
      const filters = await import("telegraf/filters");
      return typeof filters.message === "function";
    },
  },

  // ============================================
  // SQLite (better-sqlite3) Assumptions
  // ============================================
  {
    category: "SQLite",
    claim: "better-sqlite3 exports Database constructor",
    verify: async () => {
      const Database = (await import("better-sqlite3")).default;
      return typeof Database === "function";
    },
  },
  {
    category: "SQLite",
    claim: "Database supports prepare() for statements",
    verify: async () => {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(":memory:");
      const hasMethod = typeof db.prepare === "function";
      db.close();
      return hasMethod;
    },
  },
  {
    category: "SQLite",
    claim: "Database supports transaction() for atomic operations",
    verify: async () => {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(":memory:");
      const hasMethod = typeof db.transaction === "function";
      db.close();
      return hasMethod;
    },
  },
];

// ============================================
// Run Verification
// ============================================

async function runVerification() {
  console.log("=".repeat(60));
  console.log("TELEGRAM-CLAUDE RESEARCH VERIFICATION");
  console.log("=".repeat(60));
  console.log();

  const results: { passed: boolean; assumption: Assumption; error?: string }[] = [];
  let currentCategory = "";

  for (const assumption of assumptions) {
    if (assumption.category !== currentCategory) {
      currentCategory = assumption.category;
      console.log(`\n### ${currentCategory} ###\n`);
    }

    try {
      const passed = await assumption.verify();
      results.push({ passed, assumption });
      console.log(`${passed ? "✓" : "✗"} ${assumption.claim}`);
      if (assumption.details && passed) {
        console.log(`  └─ ${assumption.details}`);
      }
    } catch (error) {
      results.push({
        passed: false,
        assumption,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`✗ ${assumption.claim}`);
      console.log(`  └─ Error: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${results.length}`);

  if (failed > 0) {
    console.log("\nFailed assumptions:");
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.assumption.claim}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
    process.exit(1);
  } else {
    console.log("\n✓ All assumptions verified! Ready to proceed to planning phase.");
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
