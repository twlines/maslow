# Verification: Add GET /api/backup endpoint for SQLite database dump

## Card Title
Add GET /api/backup endpoint for SQLite database dump

## Goals
Add a GET /api/backup endpoint to AppServer.ts that creates a SQLite database backup using the better-sqlite3 backup() API, streams it as a download, and cleans up afterward. Requires bearer token auth.

## Acceptance Criteria

- [ ] GET /api/backup endpoint exists in AppServer.ts
- [ ] Uses better-sqlite3 `db.backup(destination)` API to create backup
- [ ] Backup file is created at `data/backup-{timestamp}.db`
- [ ] Response streams the backup file as a download
- [ ] `Content-Disposition: attachment` header is set with filename
- [ ] `Content-Type: application/octet-stream` header is set
- [ ] Backup file is cleaned up (deleted) after sending
- [ ] Bearer token auth is required (uses existing `authenticate()` function)
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with no new errors (`npm run lint`)

## Verification Steps

1. **Type check**: Run `npm run type-check` — should pass with no errors
2. **Lint**: Run `npm run lint` — should show 0 errors (warnings are pre-existing)
3. **Code review**:
   - Open `src/services/AppServer.ts` and search for `/api/backup`
   - Verify the route handler:
     - Computes backup path using `nodePath.dirname(config.database.path)`
     - Calls `db.backupDatabase(backupPath)` (async via Effect.tryPromise)
     - Sets correct response headers (Content-Type, Content-Disposition, Content-Length)
     - Uses `fs.createReadStream()` to stream the file
     - Cleans up with `fs.unlink()` on both `finish` and `error` events
   - Open `src/services/AppPersistence.ts` and verify:
     - `backupDatabase` method added to `AppPersistenceService` interface
     - Implementation uses `db.backup(destinationPath)` wrapped in `Effect.tryPromise`
4. **Manual test** (if server is running):
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3117/api/backup -o backup.db
   # Verify backup.db is a valid SQLite database:
   sqlite3 backup.db ".tables"
   # Verify the temp backup file was cleaned up:
   ls data/backup-*.db  # should show no files
   ```
5. **Auth test**: Verify unauthorized requests are rejected:
   ```bash
   curl http://localhost:3117/api/backup -o /dev/null -w "%{http_code}"
   # Should return 401
   ```

## Files Changed

- `src/services/AppServer.ts` — Added GET /api/backup route handler, imported `fs` and `nodePath`
- `src/services/AppPersistence.ts` — Added `backupDatabase()` to interface and implementation
