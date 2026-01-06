/**
 * Telegram Service
 *
 * Handles Telegram bot operations with Effect integration.
 */

import { Context, Effect, Layer, Queue, Stream, Deferred } from "effect";
import { Telegraf, Context as TelegrafContext } from "telegraf";
import { message } from "telegraf/filters";
import { Message, PhotoSize } from "telegraf/types";
import { ConfigService } from "./Config.js";

export interface TelegramMessage {
  chatId: number;
  userId: number;
  messageId: number;
  text?: string;
  photo?: PhotoSize[];
  caption?: string;
}

export interface TelegramService {
  /**
   * Stream of incoming messages from authorized user
   */
  readonly messages: Stream.Stream<TelegramMessage>;

  /**
   * Send a text message to a chat
   */
  sendMessage(
    chatId: number,
    text: string,
    options?: { replyToMessageId?: number; parseMode?: "Markdown" | "HTML" }
  ): Effect.Effect<Message.TextMessage, Error>;

  /**
   * Send typing indicator
   */
  sendTyping(chatId: number): Effect.Effect<void, Error>;

  /**
   * Edit an existing message
   */
  editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "Markdown" | "HTML" }
  ): Effect.Effect<void, Error>;

  /**
   * Download a file (for photos)
   */
  getFileBuffer(fileId: string): Effect.Effect<Buffer, Error>;

  /**
   * Start the bot (long polling)
   */
  start(): Effect.Effect<void, Error>;

  /**
   * Stop the bot gracefully
   */
  stop(): Effect.Effect<void>;
}

export class Telegram extends Context.Tag("Telegram")<
  Telegram,
  TelegramService
>() {}

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export const truncateMessage = (text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
};

export const TelegramLive = Layer.scoped(
  Telegram,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const bot = new Telegraf(config.telegram.botToken);
    const authorizedUserId = config.telegram.userId;

    // Queue for incoming messages
    const messageQueue = yield* Queue.unbounded<TelegramMessage>();

    // Deferred for startup completion
    const startupDeferred = yield* Deferred.make<void, Error>();

    // Set up message handler
    bot.on(message("text"), (ctx) => {
      if (ctx.from.id !== authorizedUserId) {
        // Silently ignore unauthorized users (F7.3)
        return;
      }

      Effect.runPromise(
        Queue.offer(messageQueue, {
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          messageId: ctx.message.message_id,
          text: ctx.message.text,
        })
      );
    });

    bot.on(message("photo"), (ctx) => {
      if (ctx.from.id !== authorizedUserId) {
        return;
      }

      Effect.runPromise(
        Queue.offer(messageQueue, {
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          messageId: ctx.message.message_id,
          photo: ctx.message.photo,
          caption: ctx.message.caption,
        })
      );
    });

    // Register finalizer
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        bot.stop("SIGTERM");
      })
    );

    return {
      messages: Stream.fromQueue(messageQueue),

      sendMessage: (chatId, text, options) =>
        Effect.tryPromise({
          try: () =>
            bot.telegram.sendMessage(chatId, truncateMessage(text), {
              reply_parameters: options?.replyToMessageId
                ? { message_id: options.replyToMessageId }
                : undefined,
              parse_mode: options?.parseMode,
            }),
          catch: (error) =>
            new Error(
              `Failed to send message: ${error instanceof Error ? error.message : error}`
            ),
        }),

      sendTyping: (chatId) =>
        Effect.tryPromise({
          try: () => bot.telegram.sendChatAction(chatId, "typing"),
          catch: (error) =>
            new Error(
              `Failed to send typing: ${error instanceof Error ? error.message : error}`
            ),
        }).pipe(Effect.asVoid),

      editMessage: (chatId, messageId, text, options) =>
        Effect.tryPromise({
          try: () =>
            bot.telegram.editMessageText(
              chatId,
              messageId,
              undefined,
              truncateMessage(text),
              { parse_mode: options?.parseMode }
            ),
          catch: (error) =>
            new Error(
              `Failed to edit message: ${error instanceof Error ? error.message : error}`
            ),
        }).pipe(Effect.asVoid),

      getFileBuffer: (fileId) =>
        Effect.tryPromise({
          try: async () => {
            const fileLink = await bot.telegram.getFileLink(fileId);
            const response = await fetch(fileLink.href);
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          },
          catch: (error) =>
            new Error(
              `Failed to get file: ${error instanceof Error ? error.message : error}`
            ),
        }),

      start: () =>
        Effect.sync(() => {
          // bot.launch() returns a Promise that resolves when bot STOPS, not starts
          // So we fire-and-forget and handle errors via the error handler
          bot.launch().catch((error) => {
            console.error("Bot launch error:", error);
          });
        }),

      stop: () =>
        Effect.sync(() => {
          bot.stop("SIGTERM");
        }),
    };
  })
);
