/**
 * Test Utilities
 *
 * Helper functions for testing Effect-based services.
 */

import { Effect, Layer, Runtime, Exit } from "effect";

/**
 * Run an Effect and return the result synchronously.
 * Useful for simple test assertions.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, never>
): A => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isFailure(exit)) {
    throw Exit.unannotate(exit).cause;
  }
  return exit.value;
};

/**
 * Run an Effect with a provided layer.
 */
export const runEffectWithLayer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, E, never>
): Promise<A> => {
  return Effect.runPromise(Effect.provide(effect, layer));
};

/**
 * Run an Effect and expect it to fail.
 */
export const runEffectExpectFailure = <A, E>(
  effect: Effect.Effect<A, E, never>
): E => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected effect to fail but it succeeded");
  }
  // Extract the error from the cause
  const cause = Exit.unannotate(exit).cause;
  if (cause._tag === "Fail") {
    return cause.error;
  }
  throw new Error(`Unexpected cause type: ${cause._tag}`);
};

/**
 * Create a test layer that provides a mock service.
 */
export const createMockLayer = <I, S>(
  tag: { readonly [key: string]: unknown } & { key: string },
  implementation: S
): Layer.Layer<I, never, never> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Effect Context.Tag requires runtime cast for generic test helpers
  return Layer.succeed(tag as any, implementation);
};

/**
 * Helper to create a temporary database path for testing.
 */
export const getTempDbPath = (): string => {
  return `:memory:`;
};
