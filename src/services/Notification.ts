/**
 * Notification Service
 *
 * Handles service lifecycle notifications (startup, shutdown, errors).
 */

import { Context, Effect, Layer } from "effect";
import { Telegram } from "./Telegram.js";
import { Persistence } from "./Persistence.js";
import { MessageFormatter } from "./MessageFormatter.js";
import { ConfigService } from "./Config.js";

export interface NotificationService {
  /**
   * Send startup notification
   */
  notifyStartup(): Effect.Effect<void, Error>;

  /**
   * Send shutdown notification
   */
  notifyShutdown(): Effect.Effect<void, Error>;

  /**
   * Send error notification
   */
  notifyError(error: string): Effect.Effect<void, Error>;
}

export class Notification extends Context.Tag("Notification")<
  Notification,
  NotificationService
>() {}

export const NotificationLive = Layer.effect(
  Notification,
  Effect.gen(function* () {
    const telegram = yield* Telegram;
    const persistence = yield* Persistence;
    const formatter = yield* MessageFormatter;
    const config = yield* ConfigService;

    const getNotificationChatId = (): Effect.Effect<number | null> =>
      Effect.gen(function* () {
        // Try to get the last active chat
        const lastChatId = yield* persistence.getLastActiveChatId();
        if (lastChatId) return lastChatId;

        // Fall back to the authorized user's ID as chat ID
        // (works for private bot conversations)
        return config.telegram.userId;
      });

    const sendNotification = (
      message: string
    ): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        const chatId = yield* getNotificationChatId();
        if (chatId) {
          yield* telegram.sendMessage(chatId, message).pipe(
            Effect.catchAll((error) =>
              Effect.logWarning(`Failed to send notification: ${error.message}`)
            )
          );
        }
      });

    return {
      notifyStartup: () =>
        Effect.gen(function* () {
          const message = formatter.formatNotification(
            "startup",
            `Workspace: ${config.workspace.path}`
          );
          yield* sendNotification(message);
        }),

      notifyShutdown: () =>
        Effect.gen(function* () {
          const message = formatter.formatNotification("shutdown");
          yield* sendNotification(message);
        }),

      notifyError: (error: string) =>
        Effect.gen(function* () {
          const message = formatter.formatNotification("error", error);
          yield* sendNotification(message);
        }),
    };
  })
);
