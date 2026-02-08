# Verification: Create audit_log table in AppPersistence schema

## Card Title
Create audit_log table in AppPersistence schema

## Goals
Add a general-purpose audit log table to the AppPersistence service for tracking entity changes across the system.

## Acceptance Criteria

- [ ] `audit_log` table created with `CREATE TABLE IF NOT EXISTS` in the schema init block
- [ ] Table columns: `id TEXT PRIMARY KEY`, `entity_type TEXT NOT NULL`, `entity_id TEXT NOT NULL`, `action TEXT NOT NULL`, `actor TEXT NOT NULL DEFAULT 'system'`, `details TEXT NOT NULL DEFAULT '{}'`, `created_at INTEGER NOT NULL`
- [ ] Composite index on `(entity_type, entity_id, created_at DESC)` created with `CREATE INDEX IF NOT EXISTS`
- [ ] Prepared statement `insertAuditLog` added to the `stmts` object
- [ ] `logAudit(entityType, entityId, action, details?, actor?)` method added to `AppPersistenceService` interface
- [ ] `logAudit` implementation added to the service return object, using `Effect.sync()`, `randomUUID()`, and `JSON.stringify` for details
- [ ] `details` defaults to `{}` and `actor` defaults to `"system"` when not provided
- [ ] TypeScript type-check passes (`npm run type-check`)
- [ ] ESLint passes with no new errors (`npm run lint`)

## Verification Steps

1. **Schema inspection**: Read `src/services/AppPersistence.ts` and confirm the `audit_log` table DDL appears inside the `db.exec()` schema init block (after `steering_corrections` index definitions).
2. **Index check**: Confirm `idx_audit_log_entity` index is defined on `(entity_type, entity_id, created_at DESC)`.
3. **Prepared statement**: Confirm `insertAuditLog` in the `stmts` object with 7 bind parameters matching the column order.
4. **Interface method**: Confirm `logAudit` is declared in `AppPersistenceService` with signature `(entityType: string, entityId: string, action: string, details?: Record<string, unknown>, actor?: string): Effect.Effect<void>`.
5. **Implementation**: Confirm `logAudit` in the return object generates a UUID, uses `Date.now()`, defaults `actor` to `"system"`, and JSON-stringifies `details` (defaulting to `{}`).
6. **Build**: Run `npm run type-check` — should pass with zero errors.
7. **Lint**: Run `npm run lint` — should produce zero errors (pre-existing warnings are acceptable).

## Files Changed

- `src/services/AppPersistence.ts` — schema, prepared statement, interface, and implementation
