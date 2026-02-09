# P1.2: Fix 38 no-unused-vars warnings

## Goals
Eliminate all `@typescript-eslint/no-unused-vars` warnings from `npm run lint` output, plus fix the `no-useless-assignment` error in `src/index.ts`.

## Acceptance Criteria

- [ ] `npm run lint 2>&1 | grep "no-unused-vars"` produces zero results
- [ ] `npm run lint` reports 0 errors
- [ ] No functional behavior changes — only import cleanup and `_` prefixing
- [ ] Duplicate `Heartbeat` import and `HeartbeatLayer` declaration removed from `src/index.ts`

## Verification Steps

1. Run `npm run lint` and confirm 0 `no-unused-vars` warnings
2. Run `npm run lint 2>&1 | grep "no-unused-vars" | wc -l` — should print `0`
3. Run `npm run lint 2>&1 | grep "0 errors"` — should confirm 0 errors
4. Verify no runtime behavior changed (all changes are import removals or `_` prefixes)

## Files Changed

1. **src/index.ts** — Removed unused service tag imports (Persistence, ClaudeSession, MessageFormatter, SoulLoader, ClaudeMem, Voice, AppPersistence, Kanban, ThinkingPartner, SteeringEngine), removed duplicate Heartbeat import line, removed first duplicate HeartbeatLayer declaration
2. **src/__tests__/integration/e2e-conversation.test.ts** — Removed unused imports (beforeAll, afterAll, Chunk, Fiber, ConfigLive, Telegram, TelegramLive, TelegramMessage, SessionManager, SessionManagerLive)
3. **src/__tests__/services/MessageFormatter.test.ts** — Removed unused imports (Layer, ToolCall)
4. **src/__tests__/services/Persistence.test.ts** — Removed unused import (Scope)
5. **src/__tests__/test-utils.ts** — Removed unused import (Runtime)
6. **src/services/AgentOrchestrator.ts** — Removed unused import (Stream), prefixed `cwd` param with `_`, prefixed `agentTimeoutMs` with `_`
7. **src/services/AppServer.ts** — Prefixed unused `projectId` in array destructuring with `_`
8. **src/services/ClaudeSession.ts** — Prefixed unused `config` with `_`, prefixed unused `parseError` with `_`
9. **src/services/MessageFormatter.ts** — Removed unused import (Effect)
10. **src/services/SessionManager.ts** — Prefixed unused `lastUsage` with `_`
11. **src/services/Telegram.ts** — Removed unused import (TelegrafContext), prefixed unused `startupDeferred` with `_`
