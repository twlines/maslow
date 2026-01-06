/**
 * Retry and Error Handling Utilities
 *
 * Provides retry policies and error handling patterns for the application.
 */

import { Effect, Schedule, Duration } from "effect";

/**
 * Telegram API retry policy
 * - Exponential backoff starting at 1 second
 * - Maximum 5 retries
 * - Jitter to avoid thundering herd
 */
export const telegramRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.seconds(1)).pipe(Schedule.jittered),
  Schedule.recurs(5)
);

/**
 * Claude API retry policy
 * - Exponential backoff starting at 2 seconds
 * - Maximum 3 retries
 * - Longer delays for API rate limits
 */
export const claudeRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.seconds(2)).pipe(Schedule.jittered),
  Schedule.recurs(3)
);

/**
 * Network retry policy for transient failures
 * - Exponential backoff starting at 500ms
 * - Maximum 10 retries
 */
export const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)).pipe(Schedule.jittered),
  Schedule.recurs(10)
);

/**
 * Retry an effect with the Telegram API policy
 */
export const withTelegramRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry(telegramRetryPolicy),
    Effect.tapError((error) =>
      Effect.logWarning(`Telegram API error after retries: ${error}`)
    )
  );

/**
 * Retry an effect with the Claude API policy
 */
export const withClaudeRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry(claudeRetryPolicy),
    Effect.tapError((error) =>
      Effect.logWarning(`Claude API error after retries: ${error}`)
    )
  );

/**
 * Check if an error is retryable
 */
export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused")
    ) {
      return true;
    }

    // Rate limit errors
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }

    // Temporary server errors
    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504")
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Conditionally retry only retryable errors
 */
export const retryIfRetryable = <A, R>(
  effect: Effect.Effect<A, Error, R>
): Effect.Effect<A, Error, R> =>
  Effect.retry(effect, {
    schedule: networkRetryPolicy,
    while: isRetryableError,
  });
