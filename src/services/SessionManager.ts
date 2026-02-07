/**
 * Session Manager Service
 *
 * Orchestrates chat-to-session mapping, context monitoring, and continuations.
 */

import { Context, Effect, Layer, Ref, Stream } from "effect";
import { Persistence, type SessionRecord } from "./Persistence.js";
import { ClaudeSession, type ClaudeEvent } from "./ClaudeSession.js";
import { Telegram, type TelegramMessage } from "./Telegram.js";
import { MessageFormatter } from "./MessageFormatter.js";
import { ConfigService } from "./Config.js";
import { AutonomousWorker } from "./AutonomousWorker.js";
import { Voice } from "./Voice.js";

const CONTEXT_HANDOFF_THRESHOLD = 50; // Percentage - Autonomous handoff
const CONTEXT_WARNING_THRESHOLD = 80; // Percentage - Manual warning

export interface SessionManagerService {
  /**
   * Handle an incoming Telegram message
   */
  handleMessage(message: TelegramMessage): Effect.Effect<void, Error>;

  /**
   * Handle context continuation for a chat
   */
  handleContinuation(chatId: number): Effect.Effect<void, Error>;
}

export class SessionManager extends Context.Tag("SessionManager")<
  SessionManager,
  SessionManagerService
>() {}

export const SessionManagerLive = Layer.effect(
  SessionManager,
  Effect.gen(function* () {
    const persistence = yield* Persistence;
    const claude = yield* ClaudeSession;
    const telegram = yield* Telegram;
    const formatter = yield* MessageFormatter;
    const config = yield* ConfigService;
    const autonomousWorker = yield* AutonomousWorker;
    const voice = yield* Voice;

    // Track pending continuations
    const pendingContinuations = yield* Ref.make<Set<number>>(new Set());

    const getOrCreateSession = (
      chatId: number
    ): Effect.Effect<SessionRecord, Error> =>
      Effect.gen(function* () {
        const existing = yield* persistence.getSession(chatId);
        if (existing) {
          yield* persistence.updateLastActive(chatId);
          return existing;
        }

        // Create new session record
        const newRecord: SessionRecord = {
          telegramChatId: chatId,
          claudeSessionId: "", // Will be set after first message
          projectPath: null,
          workingDirectory: config.workspace.path,
          lastActiveAt: Date.now(),
          contextUsagePercent: 0,
        };

        yield* persistence.saveSession(newRecord);
        return newRecord;
      });

    const processClaudeEvents = (
      chatId: number,
      events: Stream.Stream<ClaudeEvent, Error>,
      replyToMessageId?: number,
      respondWithVoice?: boolean
    ): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        let accumulatedText = "";
        let fullResponseText = "";
        let lastSentMessageId: number | undefined;
        let sessionId: string | undefined;
        let lastUsage: ClaudeEvent["usage"] | undefined;

        yield* Stream.runForEach(events, (event) =>
          Effect.gen(function* () {
            switch (event.type) {
              case "text":
                if (event.sessionId) {
                  sessionId = event.sessionId;
                }
                if (event.content) {
                  accumulatedText += event.content;
                  fullResponseText += event.content;

                  // Send or update message when we have substantial content
                  if (accumulatedText.length > 100 || event.content.includes("\n\n")) {
                    if (lastSentMessageId) {
                      // Try to edit, but don't fail if it doesn't work
                      yield* telegram
                        .editMessage(chatId, lastSentMessageId, accumulatedText)
                        .pipe(Effect.ignore);
                    } else {
                      const sent = yield* telegram.sendMessage(
                        chatId,
                        accumulatedText,
                        { replyToMessageId }
                      );
                      lastSentMessageId = sent.message_id;
                    }
                  }
                }
                break;

              case "tool_call":
                // Send accumulated text first
                if (accumulatedText.trim()) {
                  if (lastSentMessageId) {
                    yield* telegram
                      .editMessage(chatId, lastSentMessageId, accumulatedText)
                      .pipe(Effect.ignore);
                  } else {
                    yield* telegram.sendMessage(chatId, accumulatedText, {
                      replyToMessageId,
                    });
                  }
                  accumulatedText = "";
                  lastSentMessageId = undefined;
                }

                // Send tool call notification
                if (event.toolCall) {
                  const toolMsg = formatter.formatToolCall(event.toolCall);
                  yield* telegram.sendMessage(chatId, toolMsg);
                  yield* telegram.sendTyping(chatId);
                }
                break;

              case "tool_result":
                // Optionally show tool results (can be noisy)
                // For now, just update typing indicator
                yield* telegram.sendTyping(chatId);
                break;

              case "result":
                // Send any remaining text
                if (accumulatedText.trim()) {
                  if (lastSentMessageId) {
                    yield* telegram
                      .editMessage(chatId, lastSentMessageId, accumulatedText)
                      .pipe(Effect.ignore);
                  } else {
                    yield* telegram.sendMessage(chatId, accumulatedText, {
                      replyToMessageId,
                    });
                  }
                }

                // Synthesize and send voice response if requested
                if (respondWithVoice && fullResponseText.trim()) {
                  yield* telegram.sendRecordingVoice(chatId).pipe(Effect.ignore);
                  yield* voice
                    .synthesize(fullResponseText.trim())
                    .pipe(
                      Effect.flatMap((audioBuffer) =>
                        telegram.sendVoiceNote(chatId, audioBuffer, {
                          replyToMessageId,
                        })
                      ),
                      Effect.catchAll((err) =>
                        Effect.gen(function* () {
                          yield* Effect.logWarning(`Voice synthesis failed: ${err.message}`);
                        })
                      )
                    );
                }

                // Update session with new session ID
                if (sessionId) {
                  const record = yield* persistence.getSession(chatId);
                  if (record) {
                    yield* persistence.saveSession({
                      ...record,
                      claudeSessionId: sessionId,
                      lastActiveAt: Date.now(),
                    });
                  }
                }

                // Check context usage and warn if needed
                if (event.usage) {
                  lastUsage = event.usage;
                  const contextPercent =
                    ((event.usage.inputTokens + event.usage.outputTokens) /
                      event.usage.contextWindow) *
                    100;

                  yield* persistence.updateContextUsage(chatId, contextPercent);

                  // Autonomous handoff at 50%
                  if (contextPercent >= CONTEXT_HANDOFF_THRESHOLD && contextPercent < CONTEXT_WARNING_THRESHOLD) {
                    yield* Effect.log(`Auto-handoff triggered at ${contextPercent.toFixed(1)}% context usage`);

                    // Trigger autonomous handoff
                    yield* telegram.sendMessage(
                      chatId,
                      `🔄 Auto-handoff: Context at ${contextPercent.toFixed(1)}%. Generating summary and continuing...`
                    );

                    // Generate handoff summary
                    if (sessionId) {
                      const record = yield* persistence.getSession(chatId);
                      if (record) {
                        const summary = yield* claude.generateHandoff({
                          sessionId: sessionId,
                          cwd: record.workingDirectory,
                        });

                        // Store handoff in Claude-Mem for continuity
                        yield* Effect.tryPromise({
                          try: async () => {
                            // Import ClaudeMem (will need to add to service)
                            // For now, just log it
                            console.log("Handoff summary generated:", summary.substring(0, 100));
                          },
                          catch: () => new Error("Failed to store handoff"),
                        }).pipe(Effect.ignore);

                        // Clear old session
                        yield* persistence.deleteSession(chatId);

                        // Create new session with handoff context
                        yield* persistence.saveSession({
                          ...record,
                          claudeSessionId: "", // Will be set by next message
                          contextUsagePercent: 0,
                        });

                        yield* telegram.sendMessage(chatId, "✅ Context reset. Continuing with fresh session...");
                      }
                    }
                  } else if (contextPercent >= CONTEXT_WARNING_THRESHOLD) {
                    const warning = formatter.formatContextWarning(contextPercent);
                    yield* telegram.sendMessage(chatId, warning);
                    yield* Ref.update(pendingContinuations, (s) =>
                      new Set(s).add(chatId)
                    );
                  }
                }
                break;

              case "error": {
                const errorMsg = formatter.formatError(
                  event.error || "Unknown error"
                );
                yield* telegram.sendMessage(chatId, errorMsg);
                break;
              }
            }
          })
        );
      });

    return {
      handleMessage: (message) =>
        Effect.gen(function* () {
          const chatId = message.chatId;

          // Check if this is a continuation trigger
          const isPendingContinuation = yield* Ref.get(pendingContinuations);
          if (
            isPendingContinuation.has(chatId) &&
            message.text?.toLowerCase().includes("continue")
          ) {
            yield* Ref.update(pendingContinuations, (s) => {
              const newSet = new Set(s);
              newSet.delete(chatId);
              return newSet;
            });

            // Handle continuation
            const record = yield* persistence.getSession(chatId);
            if (record?.claudeSessionId) {
              yield* telegram.sendMessage(
                chatId,
                "📋 Generating handoff summary..."
              );

              const summary = yield* claude.generateHandoff({
                sessionId: record.claudeSessionId,
                cwd: record.workingDirectory,
              });

              // Delete old session and start fresh with handoff
              yield* persistence.deleteSession(chatId);

              const handoffMsg = formatter.formatHandoff(summary);
              yield* telegram.sendMessage(chatId, handoffMsg);

              // Create new session with handoff as context
              const events = claude.sendMessage({
                prompt: `Previous session handoff:\n\n${summary}\n\nPlease acknowledge this context and let me know you're ready to continue.`,
                cwd: record.workingDirectory,
              });

              yield* processClaudeEvents(chatId, events, message.messageId);
              return;
            }
          }

          // Handle /restart_claude command
          if (message.text === "/restart_claude") {
            const existing = yield* persistence.getSession(chatId);
            if (existing) {
              yield* persistence.deleteSession(chatId);
            }
            yield* telegram.sendMessage(chatId, "Session cleared. Next message starts a fresh Claude session.");
            return;
          }

          // Check if this is a task brief submission
          if (message.text?.startsWith("TASK:") || message.text?.startsWith("Brief:")) {
            yield* telegram.sendMessage(chatId, "🤖 **Autonomous Mode Activated**\n\nSubmitting task brief...");
            yield* autonomousWorker.submitTaskBrief(message.text);
            return;
          }

          // Regular message handling
          yield* telegram.sendTyping(chatId);

          const record = yield* getOrCreateSession(chatId);

          // Handle voice messages — transcribe to text
          let isVoiceMessage = false;
          let transcribedText: string | undefined;
          if (message.voice) {
            isVoiceMessage = true;
            const audioBuffer = yield* telegram.getFileBuffer(message.voice.fileId);
            transcribedText = yield* voice.transcribe(audioBuffer).pipe(
              Effect.catchAll((err) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning(`Voice transcription failed: ${err.message}`);
                  yield* telegram.sendMessage(chatId, "Could not transcribe voice message. Is whisper.cpp running?");
                  return undefined as unknown as string;
                })
              )
            );
            if (!transcribedText) return;
          }

          // Handle photo messages
          let images: Array<{ data: Buffer; mediaType: string }> | undefined;
          if (message.photo && message.photo.length > 0) {
            // Get the largest photo
            const largestPhoto = message.photo[message.photo.length - 1];
            const photoBuffer = yield* telegram.getFileBuffer(largestPhoto.file_id);
            images = [{ data: photoBuffer, mediaType: "image/jpeg" }];
          }

          const prompt = transcribedText || message.text || message.caption || "Please analyze this image.";

          const events = claude.sendMessage({
            prompt,
            cwd: record.workingDirectory,
            resumeSessionId: record.claudeSessionId || undefined,
            images,
          });

          yield* processClaudeEvents(chatId, events, message.messageId, isVoiceMessage);
        }),

      handleContinuation: (chatId) =>
        Effect.gen(function* () {
          const record = yield* persistence.getSession(chatId);
          if (!record?.claudeSessionId) {
            yield* telegram.sendMessage(
              chatId,
              "No active session to continue."
            );
            return;
          }

          yield* telegram.sendMessage(
            chatId,
            "📋 Generating handoff summary..."
          );

          const summary = yield* claude.generateHandoff({
            sessionId: record.claudeSessionId,
            cwd: record.workingDirectory,
          });

          // Delete old session
          yield* persistence.deleteSession(chatId);

          const handoffMsg = formatter.formatHandoff(summary);
          yield* telegram.sendMessage(chatId, handoffMsg);

          // Start new session with handoff
          const events = claude.sendMessage({
            prompt: `Previous session handoff:\n\n${summary}\n\nPlease acknowledge this context and let me know you're ready to continue.`,
            cwd: record.workingDirectory,
          });

          yield* processClaudeEvents(chatId, events);
        }),
    };
  })
);
