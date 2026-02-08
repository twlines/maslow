# Verification: Create token_usage table in AppPersistence

## Card Title
Create token_usage table in AppPersistence

## Goals
Add a `token_usage` table to the AppPersistence SQLite schema to persist per-session token consumption and cost data, along with a prepared statement and `insertTokenUsage()` service method.

## Acceptance Criteria

- [ ] `token_usage` table created with `CREATE TABLE IF NOT EXISTS` in the schema block
- [ ] Columns match spec: `id TEXT PRIMARY KEY`, `card_id TEXT`, `project_id TEXT NOT NULL`, `agent TEXT NOT NULL`, `input_tokens INTEGER NOT NULL DEFAULT 0`, `output_tokens INTEGER NOT NULL DEFAULT 0`, `cache_read_tokens INTEGER NOT NULL DEFAULT 0`, `cache_write_tokens INTEGER NOT NULL DEFAULT 0`, `cost_usd REAL NOT NULL DEFAULT 0`, `created_at INTEGER NOT NULL`
- [ ] Index `idx_token_usage_project` on `(project_id, created_at DESC)` exists
- [ ] `TokenUsage` TypeScript interface exported with camelCase field names
- [ ] `insertTokenUsage(usage: Omit<TokenUsage, "id">)` added to `AppPersistenceService` interface
- [ ] Prepared statement `insertTokenUsage` added to `stmts` object
- [ ] Method implementation added to the service return object using `Effect.sync()` and `randomUUID()`
- [ ] `npm run type-check` passes with no errors
- [ ] `npm run lint` produces no new errors (only pre-existing warnings)

## Verification Steps

1. **Type-check**: Run `npm run type-check` — should pass with no errors
2. **Lint**: Run `npm run lint` — should produce 0 errors (warnings are pre-existing)
3. **Schema review**: Read `src/services/AppPersistence.ts` and confirm:
   - The `CREATE TABLE IF NOT EXISTS token_usage` block is in the `db.exec()` schema section
   - The index is created immediately after the table
   - The prepared statement matches the table columns
4. **Interface review**: Confirm `TokenUsage` interface is exported and `insertTokenUsage` is in the service interface
5. **Method review**: Confirm the implementation generates a UUID, calls the prepared statement, and returns the full `TokenUsage` object

## Files Changed

- `src/services/AppPersistence.ts` — Added `TokenUsage` interface, table schema, index, prepared statement, service interface method, and implementation
- `verification-prompt.md` — This file
