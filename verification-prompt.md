# P3.11: Strip PR creation from agents, add orchestrator PR cycle

## Goals

- Remove PR creation logic from AgentOrchestrator.spawnAgent
- Agents commit to feature branches only, no push, no PR
- Add twice-daily orchestrator PR schedule to Heartbeat (configurable times)
- Orchestrator reviews completed branches, consolidates related changes, creates PRs

## Acceptance Criteria

- [x] AgentOrchestrator.spawnAgent does not push branches or create PRs
- [x] Agent completion handler saves context with branch name, marks card done, sends Telegram notification, and cleans up worktree
- [x] Agent prompt explicitly tells agents not to push or create PRs (lines 177, 273)
- [x] Heartbeat service has `prCycle()` method in its interface and implementation
- [x] PR cycle runs on a configurable cron schedule (default: "0 10,16 * * *" = 10am and 4pm daily)
- [x] PR_SCHEDULE env var allows configuring the cron expression
- [x] PR cycle checks `gh auth status` before attempting operations
- [x] PR cycle scans completed cards for branch names in context snapshots
- [x] PR cycle checks if branch exists locally and if PR already exists before creating
- [x] PR cycle pushes branch and creates PR with retry logic (3 attempts, 5s delay)
- [x] PR cycle sends Telegram summary of created PRs
- [x] PR cycle broadcasts `heartbeat.prCycle` WebSocket event
- [x] No duplicate imports in src/index.ts (fixed duplicate Heartbeat import)
- [x] No duplicate layer definitions in src/index.ts (fixed duplicate HeartbeatLayer)
- [x] No duplicate heartbeat.start() calls (removed second call)
- [x] SessionManagerLayer correctly provides Kanban and ThinkingPartner dependencies
- [x] Removed broken route handlers referencing non-existent AppPersistence methods (search, getAuditLog, backupDatabase)
- [x] type-check passes (`npx tsc --noEmit` — 0 errors)
- [x] lint passes (`npm run lint` — 0 errors, 92 pre-existing warnings)

## Verification Steps

1. Run `npx tsc --noEmit` — should pass with 0 errors
2. Run `npm run lint` — should pass with 0 errors (warnings only)
3. Read `src/services/AgentOrchestrator.ts` and verify:
   - No `git push`, `gh pr create`, or PR-related commands in spawnAgent
   - Agent prompt (lines 177, 273) explicitly says "do NOT push or create PRs"
   - Completion handler (line 509) logs that orchestrator will handle push/PR
4. Read `src/services/Heartbeat.ts` and verify:
   - `prCycle()` method exists in interface and implementation
   - PR cycle scheduled via cron in `start()` (configurable via PR_SCHEDULE env var)
   - `extractBranch()` parses branch from contextSnapshot
   - Push + PR creation with retry logic in `prCycle()`
5. Read `src/index.ts` and verify:
   - Single Heartbeat import (line 19)
   - Single HeartbeatLayer definition (line 75)
   - Single heartbeat.start() call (line 153)
   - SessionManagerLayer provides KanbanLayer and ThinkingPartnerLayer

## Files Changed

- `src/index.ts` — Fixed duplicate Heartbeat import, removed premature HeartbeatLayer definition, removed duplicate HeartbeatLayer from MainLayer, removed duplicate heartbeat.start() call, restored Kanban + ThinkingPartner deps for SessionManagerLayer
- `src/services/AppServer.ts` — Removed broken /api/search, /api/audit, /api/backup route handlers referencing non-existent AppPersistence methods; removed unused `fs` and `nodePath` imports; removed unused `AuditLogFilters` type import
