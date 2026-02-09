# P4.5: Unit tests for Heartbeat

## Goals
Add comprehensive unit tests for the Heartbeat service covering builder tick logic, task brief submission, and stuck card reconciliation on startup.

## Acceptance Criteria

- [x] Heartbeat.test.ts exists at `src/__tests__/services/Heartbeat.test.ts`
- [x] Tests mock Kanban and AgentOrchestrator (no real DB or child processes)
- [x] Builder tick logic tested:
  - [x] Broadcasts idle when no projects exist
  - [x] Skips archived/paused projects
  - [x] Spawns agent for backlog card
  - [x] Skips project that already has a running agent (1-per-project rule)
  - [x] Enforces global concurrency limit of 3
  - [x] Moves blocked cards back to backlog after 30 minutes
  - [x] Does NOT move recently blocked cards
  - [x] Handles spawn failure gracefully
  - [x] Broadcasts tick summary
- [x] Task brief submission tested:
  - [x] Creates card in backlog from brief text
  - [x] Matches project by name in brief text
  - [x] Uses explicit projectId when provided
  - [x] Fails when no active projects exist
  - [x] Truncates long titles to 80 chars
  - [x] Broadcasts cardCreated event
  - [x] Triggers immediate tick by default
  - [x] Skips tick when immediate=false
- [x] Startup reconciliation tested:
  - [x] Resets stuck 'running' cards to backlog
  - [x] Resets stuck 'blocked' cards to backlog
  - [x] Does NOT reset idle/completed cards
  - [x] Handles multiple projects
- [x] All 22 tests pass
- [x] No lint errors introduced
- [x] No new type-check errors introduced

## Verification Steps

1. Run the tests:
   ```bash
   npx vitest run src/__tests__/services/Heartbeat.test.ts
   ```
   Expected: 22 tests pass

2. Run lint on the test file:
   ```bash
   npx eslint src/__tests__/services/Heartbeat.test.ts
   ```
   Expected: No errors or warnings

3. Verify no new type-check regressions:
   ```bash
   npm run type-check 2>&1 | grep Heartbeat.test
   ```
   Expected: No output (test files excluded from tsconfig)

## Files Changed

- `src/__tests__/services/Heartbeat.test.ts` (new) — 22 unit tests for Heartbeat service
- `verification-prompt.md` (new) — this file
