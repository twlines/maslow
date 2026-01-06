/**
 * Planning/Implementation Verification Script for Telegram-Claude Bridge
 *
 * This script verifies the implementation is complete and correct.
 * Run post-implementation to validate all components are in place.
 *
 * Run with: npx tsx planning/telegram-claude.ts
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

interface Precondition {
  description: string;
  check: () => boolean | Promise<boolean>;
}

interface PlanStep {
  name: string;
  description: string;
  files: string[];
  preconditions: Precondition[];
}

const implementationPlan: PlanStep[] = [
  // ============================================
  // Step 1: Project Configuration
  // ============================================
  {
    name: "1. Project Configuration",
    description: "TypeScript, dependencies, and project structure",
    files: ["package.json", "tsconfig.json", ".env.example"],
    preconditions: [
      {
        description: "package.json exists with required dependencies",
        check: () => {
          const pkgPath = path.join(PROJECT_ROOT, "package.json");
          if (!fs.existsSync(pkgPath)) return false;
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          return (
            pkg.dependencies?.["@anthropic-ai/claude-code"] &&
            pkg.dependencies?.["effect"] &&
            pkg.dependencies?.["telegraf"] &&
            pkg.dependencies?.["better-sqlite3"]
          );
        },
      },
      {
        description: "tsconfig.json exists with ESM configuration",
        check: () => {
          const tsconfigPath = path.join(PROJECT_ROOT, "tsconfig.json");
          if (!fs.existsSync(tsconfigPath)) return false;
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
          return (
            tsconfig.compilerOptions?.module === "NodeNext" &&
            tsconfig.compilerOptions?.target === "ES2022"
          );
        },
      },
      {
        description: ".env.example exists with required variables",
        check: () => {
          const envPath = path.join(PROJECT_ROOT, ".env.example");
          if (!fs.existsSync(envPath)) return false;
          const content = fs.readFileSync(envPath, "utf-8");
          return (
            content.includes("TELEGRAM_BOT_TOKEN") &&
            content.includes("TELEGRAM_USER_ID") &&
            content.includes("ANTHROPIC_API_KEY")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 2: Configuration Service
  // ============================================
  {
    name: "2. Configuration Service",
    description: "Config layer for environment variables",
    files: ["src/services/Config.ts"],
    preconditions: [
      {
        description: "Config.ts exists and exports ConfigService",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Config.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class ConfigService") &&
            content.includes("ConfigLive")
          );
        },
      },
      {
        description: "Config.ts uses Effect Layer pattern",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Config.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("Context.Tag") &&
            content.includes("Layer.effect") || content.includes("Layer.succeed")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 3: Persistence Service
  // ============================================
  {
    name: "3. Persistence Service",
    description: "SQLite-based storage for chat-to-session mapping",
    files: ["src/services/Persistence.ts"],
    preconditions: [
      {
        description: "Persistence.ts exists and exports Persistence service",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Persistence.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class Persistence") &&
            content.includes("PersistenceLive")
          );
        },
      },
      {
        description: "Persistence.ts uses better-sqlite3",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Persistence.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return content.includes("better-sqlite3");
        },
      },
      {
        description: "Persistence.ts has session CRUD operations",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Persistence.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("getSession") &&
            content.includes("saveSession") &&
            content.includes("deleteSession")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 4: Telegram Service
  // ============================================
  {
    name: "4. Telegram Service",
    description: "Telegram bot wrapper with Effect integration",
    files: ["src/services/Telegram.ts"],
    preconditions: [
      {
        description: "Telegram.ts exists and exports Telegram service",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Telegram.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class Telegram") &&
            content.includes("TelegramLive")
          );
        },
      },
      {
        description: "Telegram.ts uses Telegraf",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Telegram.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return content.includes("from \"telegraf\"");
        },
      },
      {
        description: "Telegram.ts has message stream and send methods",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Telegram.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("messages") &&
            content.includes("sendMessage") &&
            content.includes("Stream")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 5: Claude Session Service
  // ============================================
  {
    name: "5. Claude Session Service",
    description: "Manages Claude Code sessions via Agent SDK",
    files: ["src/services/ClaudeSession.ts"],
    preconditions: [
      {
        description: "ClaudeSession.ts exists and exports ClaudeSession service",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/ClaudeSession.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class ClaudeSession") &&
            content.includes("ClaudeSessionLive")
          );
        },
      },
      {
        description: "ClaudeSession.ts uses Claude Agent SDK query()",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/ClaudeSession.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("@anthropic-ai/claude-code") &&
            content.includes("query")
          );
        },
      },
      {
        description: "ClaudeSession.ts supports session resume",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/ClaudeSession.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return content.includes("resume");
        },
      },
    ],
  },

  // ============================================
  // Step 6: Message Formatter
  // ============================================
  {
    name: "6. Message Formatter",
    description: "Formats Claude responses for Telegram display",
    files: ["src/services/MessageFormatter.ts"],
    preconditions: [
      {
        description: "MessageFormatter.ts exists and exports MessageFormatter",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/MessageFormatter.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class MessageFormatter") &&
            content.includes("MessageFormatterLive")
          );
        },
      },
      {
        description: "MessageFormatter.ts has tool call formatting with emojis",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/MessageFormatter.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("formatToolCall") &&
            content.includes("🔧") // default tool emoji
          );
        },
      },
    ],
  },

  // ============================================
  // Step 7: Session Manager
  // ============================================
  {
    name: "7. Session Manager",
    description: "Orchestrates chat-to-session mapping and continuations",
    files: ["src/services/SessionManager.ts"],
    preconditions: [
      {
        description: "SessionManager.ts exists and exports SessionManager",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/SessionManager.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class SessionManager") &&
            content.includes("SessionManagerLive")
          );
        },
      },
      {
        description: "SessionManager.ts handles messages and continuations",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/SessionManager.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("handleMessage") &&
            content.includes("handleContinuation")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 8: Notification Service
  // ============================================
  {
    name: "8. Notification Service",
    description: "Handles service lifecycle notifications",
    files: ["src/services/Notification.ts"],
    preconditions: [
      {
        description: "Notification.ts exists and exports Notification service",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Notification.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("export class Notification") &&
            content.includes("NotificationLive")
          );
        },
      },
      {
        description: "Notification.ts has startup/shutdown notifications",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/services/Notification.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("notifyStartup") &&
            content.includes("notifyShutdown")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 9: Main Application
  // ============================================
  {
    name: "9. Main Application",
    description: "Entry point composing all services",
    files: ["src/index.ts"],
    preconditions: [
      {
        description: "index.ts exists and imports all services",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/index.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("ConfigService") &&
            content.includes("Persistence") &&
            content.includes("Telegram") &&
            content.includes("ClaudeSession") &&
            content.includes("SessionManager") &&
            content.includes("Notification")
          );
        },
      },
      {
        description: "index.ts composes layers and runs the program",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/index.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("Layer.mergeAll") &&
            content.includes("Effect.runPromise")
          );
        },
      },
      {
        description: "index.ts handles graceful shutdown",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/index.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("SIGINT") &&
            content.includes("SIGTERM")
          );
        },
      },
    ],
  },

  // ============================================
  // Step 10: Error Handling & Retry
  // ============================================
  {
    name: "10. Error Handling & Retry Logic",
    description: "Retry with exponential backoff for API calls",
    files: ["src/lib/retry.ts"],
    preconditions: [
      {
        description: "retry.ts exists with retry policies",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/lib/retry.ts");
          if (!fs.existsSync(filePath)) return false;
          const content = fs.readFileSync(filePath, "utf-8");
          return (
            content.includes("telegramRetryPolicy") &&
            content.includes("Schedule.exponential")
          );
        },
      },
      {
        description: "retry.ts has retryIfRetryable helper",
        check: () => {
          const filePath = path.join(PROJECT_ROOT, "src/lib/retry.ts");
          const content = fs.readFileSync(filePath, "utf-8");
          return content.includes("retryIfRetryable");
        },
      },
    ],
  },

  // ============================================
  // Step 11: Build Verification
  // ============================================
  {
    name: "11. Build Verification",
    description: "Project compiles without errors",
    files: ["dist/index.js"],
    preconditions: [
      {
        description: "dist/index.js exists (project builds)",
        check: () => fs.existsSync(path.join(PROJECT_ROOT, "dist/index.js")),
      },
      {
        description: "dist/services directory exists with compiled services",
        check: () => {
          const servicesDir = path.join(PROJECT_ROOT, "dist/services");
          if (!fs.existsSync(servicesDir)) return false;
          const files = fs.readdirSync(servicesDir);
          return (
            files.some(f => f.includes("Config")) &&
            files.some(f => f.includes("Telegram")) &&
            files.some(f => f.includes("ClaudeSession"))
          );
        },
      },
    ],
  },
];

// ============================================
// Run Planning Verification
// ============================================

async function runPlanningVerification() {
  console.log("=".repeat(60));
  console.log("TELEGRAM-CLAUDE IMPLEMENTATION VERIFICATION");
  console.log("=".repeat(60));
  console.log();

  let allReady = true;
  const stepResults: { step: PlanStep; ready: boolean; failures: string[] }[] = [];

  for (const step of implementationPlan) {
    console.log(`\n### ${step.name} ###`);
    console.log(`Description: ${step.description}`);
    console.log(`Files: ${step.files.join(", ")}`);
    console.log();

    const failures: string[] = [];

    for (const precondition of step.preconditions) {
      try {
        const result = await precondition.check();
        const status = result ? "✓" : "✗";
        console.log(`  ${status} ${precondition.description}`);
        if (!result) {
          failures.push(precondition.description);
        }
      } catch (error) {
        console.log(`  ✗ ${precondition.description}`);
        console.log(`    Error: ${error instanceof Error ? error.message : error}`);
        failures.push(precondition.description);
      }
    }

    const ready = failures.length === 0;
    stepResults.push({ step, ready, failures });
    if (!ready) allReady = false;

    console.log(`\n  Status: ${ready ? "[COMPLETE]" : "[INCOMPLETE]"}`);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("IMPLEMENTATION SUMMARY");
  console.log("=".repeat(60));

  for (const { step, ready, failures } of stepResults) {
    const icon = ready ? "✓" : "✗";
    console.log(`${icon} ${step.name}`);
    if (failures.length > 0) {
      for (const failure of failures) {
        console.log(`    - MISSING: ${failure}`);
      }
    }
  }

  const completeCount = stepResults.filter((r) => r.ready).length;
  const incompleteCount = stepResults.filter((r) => !r.ready).length;

  console.log();
  console.log(`Complete: ${completeCount}/${stepResults.length}`);
  console.log(`Incomplete: ${incompleteCount}/${stepResults.length}`);

  if (allReady) {
    console.log("\n✓ All implementation checks passed!");
    process.exit(0);
  } else {
    console.log("\n✗ Some implementation checks failed.");
    process.exit(1);
  }
}

runPlanningVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
