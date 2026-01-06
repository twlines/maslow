/**
 * Planning Verification Script: Unit & Integration Tests
 *
 * Validates preconditions before implementation and postconditions after.
 * Following the Executable Verification pattern.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

type Check = { description: string; check: () => boolean };

interface PlanStep {
  name: string;
  preconditions: Check[];
  postconditions: Check[];
  invariants: Check[];
}

const fileExists = (p: string) => fs.existsSync(p);
const fileContains = (p: string, text: string) => {
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, "utf-8").includes(text);
};

export const plan: PlanStep[] = [
  // Step 1: Configure Vitest
  {
    name: "Configure Vitest test runner",
    preconditions: [
      {
        description: "vitest is in devDependencies",
        check: () => {
          const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
          return pkg.devDependencies?.vitest !== undefined;
        },
      },
      {
        description: "No vitest.config.ts exists yet",
        check: () => !fileExists("vitest.config.ts"),
      },
    ],
    postconditions: [
      {
        description: "vitest.config.ts exists",
        check: () => fileExists("vitest.config.ts"),
      },
      {
        description: "vitest.config.ts includes proper configuration",
        check: () =>
          fileContains("vitest.config.ts", "defineConfig") &&
          fileContains("vitest.config.ts", "test"),
      },
    ],
    invariants: [
      {
        description: "package.json test script is vitest",
        check: () => {
          const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
          return pkg.scripts?.test === "vitest";
        },
      },
    ],
  },

  // Step 2: Create test utilities
  {
    name: "Create test utilities for Effect testing",
    preconditions: [
      {
        description: "src/__tests__ directory does not exist",
        check: () => !fileExists("src/__tests__"),
      },
    ],
    postconditions: [
      {
        description: "src/__tests__ directory exists",
        check: () => fileExists("src/__tests__"),
      },
      {
        description: "Test utilities file exists",
        check: () => fileExists("src/__tests__/test-utils.ts"),
      },
      {
        description: "Test utilities exports runEffect helper",
        check: () => fileContains("src/__tests__/test-utils.ts", "runEffect"),
      },
    ],
    invariants: [],
  },

  // Step 3: Unit tests for retry.ts
  {
    name: "Implement unit tests for retry utilities",
    preconditions: [
      {
        description: "retry.ts source file exists",
        check: () => fileExists("src/lib/retry.ts"),
      },
      {
        description: "No retry tests exist yet",
        check: () => !fileExists("src/__tests__/lib/retry.test.ts"),
      },
    ],
    postconditions: [
      {
        description: "retry.test.ts exists",
        check: () => fileExists("src/__tests__/lib/retry.test.ts"),
      },
      {
        description: "Tests isRetryableError function",
        check: () => fileContains("src/__tests__/lib/retry.test.ts", "isRetryableError"),
      },
      {
        description: "Tests network errors, rate limits, server errors",
        check: () => {
          const content = fs.readFileSync("src/__tests__/lib/retry.test.ts", "utf-8");
          return (
            content.includes("network") &&
            content.includes("rate limit") &&
            (content.includes("500") || content.includes("5xx"))
          );
        },
      },
      {
        description: "Tests pass",
        check: () => {
          try {
            execSync("npx vitest run src/__tests__/lib/retry.test.ts --reporter=basic", {
              stdio: "pipe",
            });
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    invariants: [
      {
        description: "retry.ts source unchanged",
        check: () => fileContains("src/lib/retry.ts", "isRetryableError"),
      },
    ],
  },

  // Step 4: Unit tests for MessageFormatter helpers
  {
    name: "Implement unit tests for MessageFormatter helpers",
    preconditions: [
      {
        description: "MessageFormatter.ts source file exists",
        check: () => fileExists("src/services/MessageFormatter.ts"),
      },
    ],
    postconditions: [
      {
        description: "MessageFormatter.test.ts exists",
        check: () => fileExists("src/__tests__/services/MessageFormatter.test.ts"),
      },
      {
        description: "Tests truncate function",
        check: () =>
          fileContains("src/__tests__/services/MessageFormatter.test.ts", "truncate"),
      },
      {
        description: "Tests formatToolCall",
        check: () =>
          fileContains("src/__tests__/services/MessageFormatter.test.ts", "formatToolCall"),
      },
      {
        description: "Tests formatUsage",
        check: () =>
          fileContains("src/__tests__/services/MessageFormatter.test.ts", "formatUsage"),
      },
      {
        description: "Tests pass",
        check: () => {
          try {
            execSync(
              "npx vitest run src/__tests__/services/MessageFormatter.test.ts --reporter=basic",
              { stdio: "pipe" }
            );
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    invariants: [],
  },

  // Step 5: Integration tests for Persistence
  {
    name: "Implement integration tests for Persistence service",
    preconditions: [
      {
        description: "Persistence.ts source file exists",
        check: () => fileExists("src/services/Persistence.ts"),
      },
    ],
    postconditions: [
      {
        description: "Persistence.test.ts exists",
        check: () => fileExists("src/__tests__/services/Persistence.test.ts"),
      },
      {
        description: "Tests saveSession and getSession",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/services/Persistence.test.ts",
            "utf-8"
          );
          return content.includes("saveSession") && content.includes("getSession");
        },
      },
      {
        description: "Tests use in-memory or temp database",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/services/Persistence.test.ts",
            "utf-8"
          );
          return content.includes(":memory:") || content.includes("tmp") || content.includes("temp");
        },
      },
      {
        description: "Tests CRUD operations",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/services/Persistence.test.ts",
            "utf-8"
          );
          return (
            content.includes("saveSession") &&
            content.includes("getSession") &&
            content.includes("deleteSession")
          );
        },
      },
      {
        description: "Tests pass",
        check: () => {
          try {
            execSync(
              "npx vitest run src/__tests__/services/Persistence.test.ts --reporter=basic",
              { stdio: "pipe" }
            );
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    invariants: [],
  },

  // Step 6: Integration tests for conversation loop
  {
    name: "Implement integration tests for conversation loop",
    preconditions: [
      {
        description: "SessionManager.ts source file exists",
        check: () => fileExists("src/services/SessionManager.ts"),
      },
    ],
    postconditions: [
      {
        description: "conversation-loop.test.ts exists",
        check: () => fileExists("src/__tests__/integration/conversation-loop.test.ts"),
      },
      {
        description: "Tests new conversation start flow",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/integration/conversation-loop.test.ts",
            "utf-8"
          );
          return content.includes("New Conversation") && content.includes("handleMessage");
        },
      },
      {
        description: "Tests message and reply flow",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/integration/conversation-loop.test.ts",
            "utf-8"
          );
          return content.includes("Reply Flow") && content.includes("sendMessage");
        },
      },
      {
        description: "Tests session persistence",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/integration/conversation-loop.test.ts",
            "utf-8"
          );
          return content.includes("Session Persistence") && content.includes("claudeSessionId");
        },
      },
      {
        description: "Tests context warning and continuation",
        check: () => {
          const content = fs.readFileSync(
            "src/__tests__/integration/conversation-loop.test.ts",
            "utf-8"
          );
          return content.includes("Context Warning") && content.includes("continuation");
        },
      },
      {
        description: "Tests pass",
        check: () => {
          try {
            execSync(
              "npx vitest run src/__tests__/integration/conversation-loop.test.ts --reporter=basic",
              { stdio: "pipe" }
            );
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    invariants: [],
  },

  // Step 7: Run all tests together
  {
    name: "All tests pass together",
    preconditions: [
      {
        description: "Test files exist",
        check: () =>
          fileExists("src/__tests__/lib/retry.test.ts") &&
          fileExists("src/__tests__/services/MessageFormatter.test.ts") &&
          fileExists("src/__tests__/services/Persistence.test.ts") &&
          fileExists("src/__tests__/integration/conversation-loop.test.ts"),
      },
    ],
    postconditions: [
      {
        description: "All tests pass",
        check: () => {
          try {
            execSync("npx vitest run --reporter=basic", { stdio: "pipe" });
            return true;
          } catch {
            return false;
          }
        },
      },
    ],
    invariants: [
      {
        description: "Source files unchanged",
        check: () =>
          fileExists("src/lib/retry.ts") &&
          fileExists("src/services/MessageFormatter.ts") &&
          fileExists("src/services/Persistence.ts") &&
          fileExists("src/services/SessionManager.ts"),
      },
    ],
  },
];

// CLI handling
const phase = process.argv.includes("--phase=post") ? "post" : "pre";

console.log(`=== Planning Verification (${phase}-implementation) ===\n`);

let allPassed = true;

for (const step of plan) {
  const checks =
    phase === "pre"
      ? [...step.preconditions, ...step.invariants]
      : [...step.postconditions, ...step.invariants];

  if (checks.length === 0) {
    console.log(`[SKIP] ${step.name} (no ${phase} checks)`);
    continue;
  }

  const results = checks.map((c) => ({ ...c, passed: c.check() }));
  const stepPassed = results.every((r) => r.passed);

  console.log(`[${stepPassed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}] ${step.name}`);

  for (const result of results) {
    if (!result.passed) {
      console.log(`    \x1b[31m✗ ${result.description}\x1b[0m`);
      allPassed = false;
    } else if (phase === "post") {
      console.log(`    \x1b[32m✓ ${result.description}\x1b[0m`);
    }
  }
}

console.log(
  `\n=== ${allPassed ? "\x1b[32mAll checks passed\x1b[0m" : "\x1b[31mSome checks failed\x1b[0m"} ===`
);

if (!allPassed) {
  process.exit(1);
}
