# Verification: Add GET /api/audit endpoint with filtering

## Card Goals
Add a `GET /api/audit` endpoint to `AppServer.ts` that queries the `audit_log` table with optional `entity_type` and `entity_id` filters, pagination via `limit`/`offset`, and returns `{ items: AuditEntry[], total: number }`. Add the backing `getAuditLog(filters)` method to `AppPersistence`.

## Acceptance Criteria

- [ ] `audit_log` table created in AppPersistence schema (CREATE TABLE IF NOT EXISTS)
- [ ] `audit_log` table has columns: `id`, `entity_type`, `entity_id`, `action`, `detail`, `timestamp`
- [ ] Indexes on `(entity_type, entity_id, timestamp DESC)` and `(timestamp DESC)`
- [ ] `AuditEntry` interface exported from AppPersistence.ts
- [ ] `AuditLogFilters` interface exported from AppPersistence.ts
- [ ] `getAuditLog(filters)` method added to `AppPersistenceService` interface
- [ ] `getAuditLog` implementation supports optional `entityType`, `entityId`, `limit`, `offset` filters
- [ ] `getAuditLog` returns `{ items: AuditEntry[], total: number }`
- [ ] Default limit is 50, default offset is 0
- [ ] `GET /api/audit` route added to AppServer.ts
- [ ] Query params: `entity_type`, `entity_id`, `limit`, `offset` (all optional)
- [ ] Response conforms to `{ ok: true, data: { items: AuditEntry[], total: number } }`
- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] ESLint passes without new errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Verification Steps

1. **Type check**: Run `npm run type-check` -- should pass with 0 errors
2. **Lint**: Run `npm run lint` -- should pass with 0 errors (warnings are pre-existing)
3. **Build**: Run `npm run build` -- should compile successfully
4. **Schema inspection**: Start the server and verify `audit_log` table exists in `data/app.db`:
   ```bash
   sqlite3 data/app.db ".schema audit_log"
   ```
5. **Endpoint test (no filters)**:
   ```bash
   curl http://localhost:3117/api/audit
   ```
   Expected: `{"ok":true,"data":{"items":[],"total":0}}`
6. **Endpoint test (with filters)**:
   ```bash
   curl "http://localhost:3117/api/audit?entity_type=card&entity_id=abc&limit=10&offset=0"
   ```
   Expected: `{"ok":true,"data":{"items":[],"total":0}}`
7. **Verify response envelope**: Response should be `{ ok: true, data: { items: [...], total: N } }`

## Files Changed

- `src/services/AppPersistence.ts` -- Added `AuditEntry` interface, `AuditLogFilters` interface, `audit_log` table schema, `getAuditLog` method to interface and implementation
- `src/services/AppServer.ts` -- Added `GET /api/audit` route with query param parsing, imported `AuditLogFilters` type
