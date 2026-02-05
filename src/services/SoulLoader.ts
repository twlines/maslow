/**
 * Soul Loader Service
 *
 * Loads and caches the soul.md file for persistent AI identity.
 */

import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { ConfigService } from "./Config.js";

export interface SoulLoaderService {
  /**
   * Get the soul content (cached after first load)
   */
  getSoul(): Effect.Effect<string, Error>;

  /**
   * Reload soul from disk (for updates)
   */
  reloadSoul(): Effect.Effect<string, Error>;
}

export class SoulLoader extends Context.Tag("SoulLoader")<
  SoulLoader,
  SoulLoaderService
>() {}

export const SoulLoaderLive = Layer.effect(
  SoulLoader,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const soulPath = config.soul?.path;

    let cachedSoul: string | null = null;

    const loadSoul = (): Effect.Effect<string, Error> =>
      Effect.tryPromise({
        try: async () => {
          if (!soulPath) {
            return ""; // No soul path configured, return empty
          }

          // Expand ~ to home directory
          const expandedPath = soulPath.replace(
            /^~/,
            process.env.HOME || ""
          );

          const content = await readFile(expandedPath, "utf-8");
          cachedSoul = content;
          return content;
        },
        catch: (error) => {
          // If soul file doesn't exist, return empty string (optional feature)
          if ((error as any)?.code === "ENOENT") {
            return new Error(`Soul file not found at ${soulPath}`);
          }
          return new Error(
            `Failed to load soul: ${error instanceof Error ? error.message : error}`
          );
        },
      });

    return {
      getSoul: () => {
        if (cachedSoul !== null) {
          return Effect.succeed(cachedSoul);
        }
        return loadSoul();
      },

      reloadSoul: loadSoul,
    };
  })
);
