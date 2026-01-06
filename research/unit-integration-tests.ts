/**
 * Research Verification Script: Unit & Integration Tests
 *
 * Validates assumptions about the codebase before implementing tests.
 * Following the Executable Verification pattern.
 */

import { Project, SyntaxKind, Node } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });

interface Assumption {
  claim: string;
  verify: () => Promise<boolean>;
  details?: string;
}

const assumptions: Assumption[] = [
  // Architecture assumptions
  {
    claim: "Project uses Effect library for functional programming",
    verify: async () => {
      const sourceFiles = project.getSourceFiles("src/**/*.ts");
      for (const file of sourceFiles) {
        const imports = file.getImportDeclarations();
        for (const imp of imports) {
          if (imp.getModuleSpecifierValue() === "effect") {
            return true;
          }
        }
      }
      return false;
    },
  },
  {
    claim: "All services use Effect's Context.Tag pattern for DI",
    verify: async () => {
      const serviceFiles = project.getSourceFiles("src/services/*.ts");
      let tagCount = 0;
      for (const file of serviceFiles) {
        const classes = file.getClasses();
        for (const cls of classes) {
          const extendsClauses = cls.getExtends();
          if (extendsClauses?.getText().includes("Context.Tag")) {
            tagCount++;
          }
        }
      }
      // We expect at least 5 services with Context.Tag
      return tagCount >= 5;
    },
    details: "Expected: Config, Persistence, Telegram, ClaudeSession, MessageFormatter, SessionManager, Notification",
  },
  {
    claim: "Services export *Live layers for dependency injection",
    verify: async () => {
      const serviceFiles = project.getSourceFiles("src/services/*.ts");
      let liveLayerCount = 0;
      for (const file of serviceFiles) {
        const exports = file.getExportedDeclarations();
        for (const [name] of exports) {
          if (name.endsWith("Live")) {
            liveLayerCount++;
          }
        }
      }
      return liveLayerCount >= 5;
    },
  },

  // Test infrastructure assumptions
  {
    claim: "Vitest is configured as test runner",
    verify: async () => {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      return (
        pkg.devDependencies?.vitest !== undefined &&
        pkg.scripts?.test === "vitest"
      );
    },
  },
  {
    claim: "No existing test files (clean slate)",
    verify: async () => {
      const testFiles = project.getSourceFiles("src/**/*.test.ts");
      const specFiles = project.getSourceFiles("src/**/*.spec.ts");
      return testFiles.length === 0 && specFiles.length === 0;
    },
  },

  // Service structure assumptions
  {
    claim: "retry.ts exports isRetryableError as pure function",
    verify: async () => {
      const retryFile = project.getSourceFile("src/lib/retry.ts");
      if (!retryFile) return false;

      // Functions are defined as const arrow functions
      const varDecl = retryFile.getVariableDeclaration("isRetryableError");
      if (!varDecl) return false;

      const initializer = varDecl.getInitializer()?.getText() || "";
      const isExported = varDecl.isExported();

      return (
        isExported &&
        initializer.includes("error instanceof Error") &&
        initializer.includes("message.includes")
      );
    },
    details: "Pure function that can be unit tested without mocks",
  },
  {
    claim: "Config service has expandHomePath as internal helper",
    verify: async () => {
      const configFile = project.getSourceFile("src/services/Config.ts");
      if (!configFile) return false;

      // Look for expandHomePath as const arrow function
      const varDecl = configFile.getVariableDeclaration("expandHomePath");
      if (!varDecl) return false;

      const initializer = varDecl.getInitializer()?.getText() || "";
      return initializer.includes("os.homedir()") && initializer.includes('startsWith("~/")');
    },
    details: "Pure function for path expansion - can be extracted and tested",
  },
  {
    claim: "MessageFormatter has pure helper functions (truncate, getToolEmoji)",
    verify: async () => {
      const formatterFile = project.getSourceFile("src/services/MessageFormatter.ts");
      if (!formatterFile) return false;

      const varDecls = formatterFile.getVariableDeclarations();
      const varNames = varDecls.map((v) => v.getName());

      return (
        varNames.includes("truncate") &&
        varNames.includes("getToolEmoji") &&
        varNames.includes("formatToolInput")
      );
    },
    details: "Helper functions can be tested independently",
  },
  {
    claim: "Persistence uses SQLite with better-sqlite3",
    verify: async () => {
      const persistenceFile = project.getSourceFile("src/services/Persistence.ts");
      if (!persistenceFile) return false;

      const imports = persistenceFile.getImportDeclarations();
      for (const imp of imports) {
        if (imp.getModuleSpecifierValue() === "better-sqlite3") {
          return true;
        }
      }
      return false;
    },
    details: "Integration tests will need in-memory SQLite database",
  },
  {
    claim: "Persistence service has CRUD operations as separate methods",
    verify: async () => {
      const persistenceFile = project.getSourceFile("src/services/Persistence.ts");
      if (!persistenceFile) return false;

      const content = persistenceFile.getText();
      const requiredMethods = [
        "getSession",
        "saveSession",
        "updateLastActive",
        "updateContextUsage",
        "deleteSession",
        "getLastActiveChatId",
      ];

      return requiredMethods.every((method) => content.includes(method));
    },
  },
  {
    claim: "ClaudeEvent has discriminated union type with 'type' field",
    verify: async () => {
      const claudeFile = project.getSourceFile("src/services/ClaudeSession.ts");
      if (!claudeFile) return false;

      const interfaces = claudeFile.getInterfaces();
      for (const iface of interfaces) {
        if (iface.getName() === "ClaudeEvent") {
          const typeProperty = iface.getProperty("type");
          if (typeProperty) {
            const type = typeProperty.getType().getText();
            return (
              type.includes("text") &&
              type.includes("tool_call") &&
              type.includes("result")
            );
          }
        }
      }
      return false;
    },
    details: "Test events can use discriminated unions",
  },
  {
    claim: "TypeScript strict mode is enabled",
    verify: async () => {
      const tsConfig = JSON.parse(fs.readFileSync("tsconfig.json", "utf-8"));
      return tsConfig.compilerOptions?.strict === true;
    },
  },
  {
    claim: "Project uses ESM modules (type: module)",
    verify: async () => {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      return pkg.type === "module";
    },
  },
];

async function main() {
  console.log("=== Research Verification: Unit & Integration Tests ===\n");

  let passed = 0;
  let failed = 0;

  for (const assumption of assumptions) {
    try {
      const result = await assumption.verify();
      if (result) {
        console.log(`\x1b[32m✓\x1b[0m ${assumption.claim}`);
        if (assumption.details) {
          console.log(`  \x1b[90m${assumption.details}\x1b[0m`);
        }
        passed++;
      } else {
        console.log(`\x1b[31m✗\x1b[0m ${assumption.claim}`);
        if (assumption.details) {
          console.log(`  \x1b[90m${assumption.details}\x1b[0m`);
        }
        failed++;
      }
    } catch (error) {
      console.log(`\x1b[31m✗\x1b[0m ${assumption.claim}`);
      console.log(`  \x1b[31mError: ${error}\x1b[0m`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}/${assumptions.length}`);
  console.log(`Failed: ${failed}/${assumptions.length}`);

  if (failed > 0) {
    console.log("\n\x1b[31mSome assumptions failed. Review before proceeding.\x1b[0m");
    process.exit(1);
  } else {
    console.log("\n\x1b[32mAll assumptions verified. Ready for planning phase.\x1b[0m");
  }
}

main();
