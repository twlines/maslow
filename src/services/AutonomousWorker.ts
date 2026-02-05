/**
 * Autonomous Worker Service
 *
 * Periodically checks Claude-Mem for pending tasks and executes them autonomously.
 * Enables true "go ham" mode - hand off a brief and let Mazlow work independently.
 */

import { Context, Effect, Layer, Stream } from "effect";
import cron from "node-cron";
import { Telegram } from "./Telegram.js";
import { ClaudeMem } from "./ClaudeMem.js";
import { ClaudeSession } from "./ClaudeSession.js";
import { ConfigService } from "./Config.js";
import { Persistence } from "./Persistence.js";

export interface AutonomousWorkerService {
  /**
   * Start autonomous task worker
   */
  start(): Effect.Effect<void, Error>;

  /**
   * Stop autonomous task worker
   */
  stop(): Effect.Effect<void, Error>;

  /**
   * Submit a task brief for autonomous execution
   */
  submitTaskBrief(brief: string): Effect.Effect<void, Error>;
}

export class AutonomousWorker extends Context.Tag("AutonomousWorker")<
  AutonomousWorker,
  AutonomousWorkerService
>() {}

export const AutonomousWorkerLive = Layer.effect(
  AutonomousWorker,
  Effect.gen(function* () {
    const telegram = yield* Telegram;
    const claudeMem = yield* ClaudeMem;
    const claude = yield* ClaudeSession;
    const config = yield* ConfigService;
    const persistence = yield* Persistence;

    const chatId = config.telegram.userId;
    const tasks: cron.ScheduledTask[] = [];

    const executeTask = (taskDescription: string): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* Effect.log(`Executing autonomous task: ${taskDescription.substring(0, 50)}...`);

        // Notify user
        yield* telegram.sendMessage(
          chatId,
          `🤖 **Autonomous Task Started**\n\n${taskDescription.substring(0, 200)}...`
        );

        // Get or create session for autonomous work
        const existingRecord = yield* persistence.getSession(chatId).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        );

        const record = existingRecord || {
          telegramChatId: chatId,
          claudeSessionId: "",
          projectPath: null,
          workingDirectory: config.workspace.path,
          lastActiveAt: Date.now(),
          contextUsagePercent: 0,
        };

        // Execute task via Claude
        const prompt = `You are working autonomously on the following task brief. Execute it completely without waiting for user input. Use all available tools and work until the task is done or you hit a blocker.

**Task Brief:**
${taskDescription}

**Instructions:**
- Work autonomously with bypassPermissions mode
- Make decisions and proceed without asking
- Report progress as you go
- Store important findings in memory
- If you hit a blocker, explain what's needed and pause

Begin execution now.`;

        const events = claude.sendMessage({
          prompt,
          cwd: record.workingDirectory,
          resumeSessionId: record.claudeSessionId || undefined,
        });

        // Process events and send to Telegram
        let fullResponse = "";
        yield* Stream.runForEach(events, (event) =>
          Effect.gen(function* () {
            if (event.type === "text" && event.content) {
              fullResponse += event.content;

              // Send progress updates periodically
              if (fullResponse.length % 500 < 100) {
                yield* telegram.sendMessage(chatId, `⚙️ Working...`).pipe(
                  Effect.ignore
                );
              }
            } else if (event.type === "result") {
              // Task completed
              yield* telegram.sendMessage(
                chatId,
                `✅ **Task Completed**\n\nFull output stored in memory.`
              );

              // Store result in Claude-Mem
              yield* claudeMem.store(
                `Autonomous task completed:\n\nTask: ${taskDescription}\n\nResult: ${fullResponse}`
              );
            } else if (event.type === "error") {
              yield* telegram.sendMessage(
                chatId,
                `❌ **Task Error**: ${event.error}`
              );
              throw new Error(event.error || "Unknown error");
            }
          })
        );
      });

    return {
      start: () =>
        Effect.gen(function* () {
          yield* Effect.log("Starting autonomous task worker...");

          // Check for pending tasks every 15 minutes
          const workerTask = cron.schedule("*/15 * * * *", () => {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* Effect.log("Checking for pending autonomous tasks...");

                // Query Claude-Mem for pending tasks
                const pendingTasks = yield* claudeMem.query(
                  "autonomous tasks that are pending or in-progress, not completed"
                );

                if (pendingTasks && pendingTasks.trim().length > 50) {
                  yield* Effect.log(`Found pending tasks: ${pendingTasks.substring(0, 100)}`);

                  // Execute the first pending task
                  yield* executeTask(pendingTasks);
                }
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(`Autonomous worker error: ${error.message}`)
                )
              )
            );
          });

          tasks.push(workerTask);

          yield* Effect.log("Autonomous task worker started (checks every 15 min)");
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Effect.log("Stopping autonomous task worker...");
          tasks.forEach((task) => task.stop());
          tasks.length = 0;
        }),

      submitTaskBrief: (brief: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`Submitting task brief: ${brief.substring(0, 50)}...`);

          // Store in Claude-Mem as pending task
          yield* claudeMem.store(
            `AUTONOMOUS TASK (pending):\n\n${brief}\n\nStatus: PENDING\nSubmitted: ${new Date().toISOString()}`
          );

          // Immediately execute (don't wait for cron)
          yield* executeTask(brief);
        }),
    };
  })
);
