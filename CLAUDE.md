# Maslow — Engineering Standards

## Architecture

Effect-TS monorepo with npm workspaces.

```
maslow/
├── src/                    # Server (Effect-TS service layers)
│   └── services/           # Context.Tag + Layer.effect pattern
├── apps/
│   └── mobile/             # Expo (React Native) client
├── packages/
│   └── shared/             # Types, crypto, API routes
├── data/                   # SQLite databases (gitignored)
└── scripts/                # Voice setup, utilities
```

### Boundary Rules
- `apps/*` can only import from `packages/*`
- `packages/*` can only import from other `packages/*`
- `src/` (server) can import from `packages/*`
- No circular dependencies

### Service Layer Pattern
Every service follows:
```typescript
export interface FooService {
  doThing(): Effect.Effect<Result, Error>;
}

export class Foo extends Context.Tag("Foo")<Foo, FooService>() {}

export const FooLive = Layer.effect(
  Foo,
  Effect.gen(function* () {
    const dep = yield* SomeDependency;
    return { doThing: () => ... };
  })
);
```

Use `Layer.scoped` with `Effect.addFinalizer` for services that hold resources (DB connections, HTTP servers, child processes).

### Layer Composition Order
```
Config
  → Persistence, Telegram, AppPersistence, Voice, ClaudeMem, SoulLoader
    → Kanban, ThinkingPartner
    → ClaudeSession
      → SessionManager
      → AppServer
```

## TypeScript

- **Strict mode** — `strict: true` in tsconfig, no exceptions
- **No `any`** — use `unknown` and narrow, or define proper types
- **No `as` casts** unless you can prove structural compatibility
- **Prefer interfaces** over type aliases for service contracts
- **Unused vars** — prefix with `_` if intentionally unused
- **Effect types** — always specify error channel: `Effect.Effect<A, E>`, not just `Effect.Effect<A>`

## Code Style

- No semicolons (follow existing codebase pattern)
- Double quotes for strings
- 2-space indentation
- Explicit return types on service methods
- No barrel exports — import from specific files

## Database

- SQLite via `better-sqlite3` (synchronous, WAL mode)
- All queries via prepared statements (in `stmts` object)
- Schema uses `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`
- Migrations via `ALTER TABLE ADD COLUMN` with existence checks
- Foreign keys enabled (`PRAGMA foreign_keys = ON`)
- JSON columns for flexible metadata (parse on read)

## Security

- **E2E encryption ready** — X25519 + AES-256-GCM in `packages/shared/src/crypto/`
- **No secrets in code** — all config via `.env` (gitignored)
- **ANTHROPIC_API_KEY stripped** from child process env (Claude CLI uses OAuth)
- **Input validation** — validate all WebSocket and REST inputs before processing
- **Single-user assumption** — but code should not rely on it; scope data by project/conversation

## Testing

- **Vitest** for server tests (`src/__tests__/`)
- Test files: `*.test.ts`
- Coverage: v8 provider, text + HTML reporters
- Timeout: 10 seconds default

## Voice Pipeline

- Whisper.cpp on port 8080 (Metal GPU acceleration)
- Chatterbox TTS on port 4123 (**CPU only** — MPS hangs on device loading)
- WAV→OGG conversion via ffmpeg for Telegram delivery
- Voice services are optional — gracefully degrade if unavailable

## Claude CLI Integration

- Spawned with: `-p --verbose --output-format stream-json --permission-mode bypassPermissions --max-turns 50`
- JSONL stream parsing for events (system, assistant, user, result)
- Session resumption via `--resume sessionId`
- Soul.md injected on new sessions (not resumed ones)
- ClaudeMem queried pre-prompt, summarized post-session

## Development Workflow

```bash
npm run dev          # Start server (tsx, hot reload)
npm run build        # TypeScript compile
npm run test         # Vitest
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run type-check   # tsc --noEmit
```

## Key Gotchas

- Chatterbox TTS hangs on MPS — always use `DEVICE=cpu`
- Effect Config optional values return `Option` type — check `._tag === "Some"`
- Expo tabs template creates `two.tsx` — delete and create custom tabs
- npm workspace packages install from root (`npm install` at repo root)
- `better-sqlite3` operations are synchronous — wrap in `Effect.sync()`, not `Effect.tryPromise()`
