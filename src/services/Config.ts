/**
 * Configuration Service
 *
 * Provides typed access to environment variables using Effect's service pattern.
 */

import { Context, Effect, Layer, Config, ConfigError } from "effect";
import * as os from "os";
import * as path from "path";

export interface AppConfig {
  readonly telegram: {
    readonly botToken: string;
    readonly userId: number;
  };
  readonly anthropic: {
    readonly apiKey: string;
  };
  readonly workspace: {
    readonly path: string;
  };
  readonly database: {
    readonly path: string;
  };
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  AppConfig
>() {}

const expandHomePath = (p: string): string => {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
};

export const ConfigLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const botToken = yield* Config.string("TELEGRAM_BOT_TOKEN");
    const userIdStr = yield* Config.string("TELEGRAM_USER_ID");
    const userId = parseInt(userIdStr, 10);

    if (isNaN(userId)) {
      return yield* Effect.fail(
        ConfigError.InvalidData(
          [],
          "TELEGRAM_USER_ID must be a valid integer"
        )
      );
    }

    const apiKey = yield* Config.string("ANTHROPIC_API_KEY");

    const workspacePath = yield* Config.string("WORKSPACE_PATH").pipe(
      Config.withDefault("~/Workspace")
    );

    const databasePath = yield* Config.string("DATABASE_PATH").pipe(
      Config.withDefault("./data/sessions.db")
    );

    return {
      telegram: {
        botToken,
        userId,
      },
      anthropic: {
        apiKey,
      },
      workspace: {
        path: expandHomePath(workspacePath),
      },
      database: {
        path: expandHomePath(databasePath),
      },
    };
  })
);
