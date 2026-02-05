/**
 * Telegram-Claude: Claude Code via Telegram
 *
 * Main application entry point that composes all services and runs the bot.
 */

import "dotenv/config";
import { Effect, Layer, Stream, Fiber } from "effect";
import { ConfigService, ConfigLive } from "./services/Config.js";
import { Persistence, PersistenceLive } from "./services/Persistence.js";
import { Telegram, TelegramLive } from "./services/Telegram.js";
import { ClaudeSession, ClaudeSessionLive } from "./services/ClaudeSession.js";
import { MessageFormatter, MessageFormatterLive } from "./services/MessageFormatter.js";
import { SessionManager, SessionManagerLive } from "./services/SessionManager.js";
import { Notification, NotificationLive } from "./services/Notification.js";
import { SoulLoader, SoulLoaderLive } from "./services/SoulLoader.js";
import { ClaudeMem, ClaudeMemLive } from "./services/ClaudeMem.js";
import { Proactive, ProactiveLive } from "./services/Proactive.js";
import { AutonomousWorker, AutonomousWorkerLive } from "./services/AutonomousWorker.js";
import { retryIfRetryable } from "./lib/retry.js";

// Build layers from bottom up (dependencies first)
// Layer 1: Config (no dependencies)
const ConfigLayer = ConfigLive;

// Layer 2: Services that only need Config
const Layer2 = Layer.mergeAll(
  PersistenceLive,
  TelegramLive,
  SoulLoaderLive,
  ClaudeMemLive,
  MessageFormatterLive
).pipe(Layer.provide(ConfigLayer));

// Layer 2.5: ClaudeSession needs Config, SoulLoader, and ClaudeMem
const ClaudeSessionLayer = ClaudeSessionLive.pipe(
  Layer.provide(Layer2),
  Layer.provide(ConfigLayer)
);

// Layer 3: AutonomousWorker needs Telegram, ClaudeMem, ClaudeSession, Persistence, Config
const AutonomousWorkerLayer = AutonomousWorkerLive.pipe(
  Layer.provide(ClaudeSessionLayer),
  Layer.provide(Layer2),
  Layer.provide(ConfigLayer)
);

// Layer 4: SessionManager needs Persistence, ClaudeSession, Telegram, MessageFormatter, AutonomousWorker, Config
const SessionManagerLayer = SessionManagerLive.pipe(
  Layer.provide(AutonomousWorkerLayer),
  Layer.provide(ClaudeSessionLayer),
  Layer.provide(Layer2),
  Layer.provide(ConfigLayer)
);

// Layer 5: Notification needs Telegram, Persistence, MessageFormatter, Config
const NotificationLayer = NotificationLive.pipe(
  Layer.provide(Layer2),
  Layer.provide(ConfigLayer)
);

// Layer 6: Proactive needs Telegram, ClaudeMem, Config
const ProactiveLayer = ProactiveLive.pipe(
  Layer.provide(Layer2),
  Layer.provide(ConfigLayer)
);

// Final composed layer
const MainLayer = Layer.mergeAll(
  ConfigLayer,
  Layer2,
  ClaudeSessionLayer,
  AutonomousWorkerLayer,
  SessionManagerLayer,
  NotificationLayer,
  ProactiveLayer
);

const program = Effect.gen(function* () {
  const telegram = yield* Telegram;
  const sessionManager = yield* SessionManager;
  const notification = yield* Notification;
  const proactive = yield* Proactive;
  const autonomousWorker = yield* AutonomousWorker;
  const config = yield* ConfigService;

  // Log startup
  yield* Effect.log(`Starting Telegram-Claude bot...`);
  yield* Effect.log(`Workspace: ${config.workspace.path}`);
  yield* Effect.log(`Authorized user: ${config.telegram.userId}`);

  // Start the bot
  yield* telegram.start();
  yield* Effect.log("Bot started, listening for messages...");

  // Start proactive intelligence tasks
  yield* proactive.start();

  // Start autonomous task worker
  yield* autonomousWorker.start();

  // Send startup notification
  yield* notification.notifyStartup().pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(`Failed to send startup notification: ${error.message}`)
    )
  );

  // Process incoming messages
  const messageProcessor = Stream.runForEach(telegram.messages, (message) =>
    Effect.gen(function* () {
      yield* Effect.log(
        `Received message from chat ${message.chatId}: ${message.text?.slice(0, 50) || "[photo]"}...`
      );

      yield* sessionManager.handleMessage(message).pipe(
        retryIfRetryable,
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.logError(`Error handling message: ${error.message}`);
            yield* telegram
              .sendMessage(
                message.chatId,
                `❌ Error: ${error.message}`
              )
              .pipe(Effect.ignore);
          })
        )
      );
    })
  );

  // Run message processor in a fiber
  const processorFiber = yield* Effect.fork(messageProcessor);

  // Set up graceful shutdown
  const shutdown = Effect.gen(function* () {
    yield* Effect.log("Shutting down...");

    // Stop proactive tasks
    yield* proactive.stop();

    // Stop autonomous worker
    yield* autonomousWorker.stop();

    // Send shutdown notification
    yield* notification.notifyShutdown().pipe(
      Effect.timeout("5 seconds"),
      Effect.catchAll(() => Effect.void)
    );

    // Stop the bot
    yield* telegram.stop();

    // Interrupt the processor
    yield* Fiber.interrupt(processorFiber);

    yield* Effect.log("Shutdown complete.");
  });

  // Handle process signals
  const handleSignal = (signal: string) => {
    console.log(`\nReceived ${signal}`);
    Effect.runPromise(shutdown).then(() => process.exit(0));
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  // Keep running until interrupted
  yield* Fiber.join(processorFiber);
});

// Run the program
const runnable = Effect.provide(program, MainLayer);

Effect.runPromise(runnable).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
