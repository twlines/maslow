# Verification: Add audit logging to kanban card operations

## Card Title
Add audit logging to kanban card operations

## Goals
Add `db.logAudit()` calls after each mutating kanban operation in `Kanban.ts`, with `entity_type="kanban_card"`, the card ID, a descriptive action name, and relevant details as a JSON-serializable object.

## Acceptance Criteria

- [ ] `audit_log` table exists in the AppPersistence schema with columns: `id`, `entity_type`, `entity_id`, `action`, `actor`, `details`, `created_at`
- [ ] `logAudit` method is declared on the `AppPersistenceService` interface
- [ ] `logAudit` implementation uses a prepared statement, generates a UUID, and JSON-stringifies details
- [ ] `createCard` logs `card.created` with `projectId`, `title`, `column`
- [ ] `deleteCard` logs `card.deleted` with `title`, `column` (fetches card before deletion)
- [ ] `moveCard` logs `card.moved` with `from` and `to` columns
- [ ] `startWork` logs `card.started` with `agent`
- [ ] `completeWork` logs `card.completed`
- [ ] `skipToBack` logs `card.skipped_to_back` with `projectId`
- [ ] All audit calls use `entity_type="kanban_card"` and pass the card `id`
- [ ] TypeScript compiles with zero errors (`npm run type-check`)
- [ ] ESLint produces no new errors (`npm run lint`)

## Verification Steps

1. Run `npm run type-check` -- should pass with zero errors
2. Run `npm run lint` -- should produce no new errors (pre-existing warnings are acceptable)
3. Review `src/services/AppPersistence.ts`:
   - Confirm `audit_log` table DDL in schema initialization (~line 293)
   - Confirm `insertAuditLog` prepared statement in `stmts` object (~line 484)
   - Confirm `logAudit` on `AppPersistenceService` interface (~line 170)
   - Confirm `logAudit` implementation in return object (~line 960)
4. Review `src/services/Kanban.ts`:
   - Confirm `createCard` (line ~84) calls `db.logAudit("kanban_card", card.id, "card.created", ...)`
   - Confirm `deleteCard` (line ~97) fetches card first, then deletes, then logs
   - Confirm `moveCard` (line ~107) captures `fromColumn` before move, logs with `from`/`to`
   - Confirm `startWork` (line ~171) logs with agent info
   - Confirm `completeWork` (line ~182) logs `card.completed`
   - Confirm `skipToBack` (line ~146) logs with `projectId`

## Files Changed

- `src/services/AppPersistence.ts` -- Added `audit_log` table, `logAudit` interface method, prepared statement, and implementation
- `src/services/Kanban.ts` -- Added `db.logAudit()` calls to `createCard`, `deleteCard`, `moveCard`, `startWork`, `completeWork`, `skipToBack`
- `verification-prompt.md` -- This file
