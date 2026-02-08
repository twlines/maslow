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
  readonly soul?: {
    readonly path: string;
  };
  readonly claudeMem?: {
    readonly url: string;
    readonly token?: string;
  };
  readonly voice?: {
    readonly whisperUrl: string;
    readonly chatterboxUrl: string;
    readonly voiceName: string;
  };
  readonly appServer?: {
    readonly port: number;
    readonly authToken: string;
    readonly tlsCertPath?: string;
    readonly tlsKeyPath?: string;
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

    // Optional: Soul and Claude-Mem configuration
    const soulPath = yield* Config.string("SOUL_PATH").pipe(
      Config.option
    );

    const claudeMemUrl = yield* Config.string("CLAUDE_MEM_URL").pipe(
      Config.option
    );
    const claudeMemToken = yield* Config.string("CLAUDE_MEM_TOKEN").pipe(
      Config.option
    );

    // Optional: Voice service configuration
    const whisperUrl = yield* Config.string("WHISPER_URL").pipe(
      Config.withDefault("http://localhost:8080")
    );
    const chatterboxUrl = yield* Config.string("CHATTERBOX_URL").pipe(
      Config.withDefault("http://localhost:4123")
    );
    const voiceName = yield* Config.string("VOICE_NAME").pipe(
      Config.withDefault("Maslow")
    );

    // Optional: App server configuration
    const appServerPortStr = yield* Config.string("APP_SERVER_PORT").pipe(
      Config.withDefault("3117")
    );
    const appServerPort = parseInt(appServerPortStr, 10) || 3117;
    const appServerToken = yield* Config.string("APP_SERVER_TOKEN").pipe(
      Config.withDefault("")
    );

    const tlsCertPath = yield* Config.string("APP_SERVER_TLS_CERT").pipe(
      Config.option
    );
    const tlsKeyPath = yield* Config.string("APP_SERVER_TLS_KEY").pipe(
      Config.option
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
      ...(soulPath._tag === "Some" && {
        soul: { path: expandHomePath(soulPath.value) },
      }),
      ...(claudeMemUrl._tag === "Some" && (() => {
        const memUrl = claudeMemUrl.value
        const parsed = new URL(memUrl)
        const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
        if (!isLocalhost && parsed.protocol !== "https:") {
          console.warn("CLAUDE_MEM_URL: non-localhost URLs must use HTTPS — disabling Claude-Mem")
          return {}
        }
        return {
          claudeMem: {
            url: memUrl,
            ...(claudeMemToken._tag === "Some" && { token: claudeMemToken.value }),
          },
        }
      })()),
      voice: {
        whisperUrl,
        chatterboxUrl,
        voiceName,
      },
      appServer: {
        port: appServerPort,
        authToken: appServerToken,
        ...(tlsCertPath._tag === "Some" && { tlsCertPath: expandHomePath(tlsCertPath.value) }),
        ...(tlsKeyPath._tag === "Some" && { tlsKeyPath: expandHomePath(tlsKeyPath.value) }),
      },
    };
  })
);
