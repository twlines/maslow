# Verification: Add audit logging to agent lifecycle events

## Card Goals

Add `db.logAudit()` calls at key agent lifecycle points in `AgentOrchestrator.ts` so that every agent spawn, completion, failure, and timeout is recorded in an `audit_log` table for traceability and debugging.

## Acceptance Criteria

- [ ] `audit_log` table created in AppPersistence schema with columns: `id`, `entity_type`, `entity_id`, `action`, `details` (JSON), `timestamp`
- [ ] `logAudit()` method added to `AppPersistenceService` interface
- [ ] `logAudit()` implementation added to `AppPersistenceLive`
- [ ] `agent.spawned` audit log emitted when agent process starts — `entity_type="agent"`, `action="agent.spawned"`, `details={cardId, agent, branchName}`
- [ ] `agent.completed` audit log emitted when agent process exits with code 0 — `action="agent.completed"`, `details={cardId, agent, branchName}`
- [ ] `agent.failed` audit log emitted when agent process exits with non-zero code OR spawn error — `action="agent.failed"`, `details={cardId, agent, exitCode, reason}`
- [ ] `agent.timeout` audit log emitted when agent exceeds max runtime — `action="agent.timeout"`, `details={cardId, agent, timeoutMs}`
- [ ] Timeout watchdog kills agent after 30 minutes with SIGTERM then SIGKILL
- [ ] TypeScript compiles with zero errors (`npm run type-check`)
- [ ] ESLint passes with zero new errors (`npm run lint`)

## Verification Steps

1. **Type check**: Run `npm run type-check` — should pass with no errors.
2. **Lint**: Run `npm run lint` — should pass with zero errors (pre-existing warnings OK).
3. **Schema review**: Verify `audit_log` table DDL in `AppPersistence.ts` uses `CREATE TABLE IF NOT EXISTS` pattern.
4. **Interface review**: Verify `logAudit` method signature on `AppPersistenceService` interface matches implementation.
5. **Spawned audit**: In `spawnAgent()`, verify `db.logAudit("agent", ...)` is called with `yield*` (inside Effect.gen).
6. **Completed audit**: In `child.on("close")` when `code === 0`, verify `db.logAudit` is called inside the existing `Effect.runPromise(Effect.gen(...))` block.
7. **Failed audit (exit code)**: In `child.on("close")` when `code !== 0`, verify `db.logAudit` is called via `Effect.runPromise(Effect.gen(...))`.
8. **Failed audit (spawn error)**: In `child.on("error")`, verify `db.logAudit` is called via `Effect.runPromise(Effect.gen(...))`.
9. **Timeout audit**: Verify timeout watchdog fires after `MAX_AGENT_RUNTIME_MS` (30 min), kills process, and logs `agent.timeout`.
10. **Timeout cleanup**: Verify `clearTimeout(timeoutTimer)` is called on process close to prevent timeout firing after normal exit.

## Files Changed

- `src/services/AppPersistence.ts` — Added `audit_log` table schema, `logAudit` prepared statement, interface method, and implementation
- `src/services/AgentOrchestrator.ts` — Added audit log calls at 4 lifecycle points and timeout watchdog mechanism
