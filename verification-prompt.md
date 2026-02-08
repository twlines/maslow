# Verification: B9-B11 Extract Audit + TokenUsage + Search Repositories

## Card Title & Goals
Extract three small repositories from AppPersistence into `src/services/persistence/`:
- **AuditRepository** — `logAudit`, `getAuditLog`
- **TokenUsageRepository** — `insertTokenUsage`
- **SearchRepository** — full-text search via FTS5 across kanban_cards, project_documents, decisions

Each repository depends only on DatabaseManager.

## Acceptance Criteria

- [ ] `src/services/persistence/DatabaseManager.ts` exists with `Context.Tag("DatabaseManager")` wrapping a `better-sqlite3` Database instance
- [ ] `src/services/persistence/AuditRepository.ts` exists with:
  - [ ] `AuditLogFilters` interface (entityType, entityId, action, actor, limit, offset)
  - [ ] `AuditLogEntry` interface
  - [ ] `AuditLogResult` interface (entries + total count)
  - [ ] `AuditRepositoryService` with `logAudit()` and `getAuditLog()` methods
  - [ ] `AuditRepositoryLive` layer depending on DatabaseManager
- [ ] `src/services/persistence/TokenUsageRepository.ts` exists with:
  - [ ] `TokenUsage` interface
  - [ ] `TokenUsageRepositoryService` with `insertTokenUsage()` method
  - [ ] `TokenUsageRepositoryLive` layer depending on DatabaseManager
- [ ] `src/services/persistence/SearchRepository.ts` exists with:
  - [ ] `SearchResult` interface (type, id, projectId, title, snippet, rank)
  - [ ] `SearchRepositoryService` with `search(query, projectId?)` method
  - [ ] `SearchRepositoryLive` layer depending on DatabaseManager
  - [ ] FTS5 queries across kanban_cards_fts, project_documents_fts, decisions_fts
- [ ] `AppPersistenceService` interface updated with `getAuditLog()` and `search()` methods
- [ ] `AppPersistenceLive` implements `getAuditLog()` and `search()` inline
- [ ] `AuditLogFilters` type is properly re-exported from AppPersistence (fixes AppServer.ts import)
- [ ] No new lint errors introduced
- [ ] No new type-check errors introduced

## Verification Steps

1. **Type-check**: `npx tsc --noEmit` — no new errors (pre-existing Heartbeat/backupDatabase errors are expected)
2. **Lint**: `npx eslint src/services/persistence/*.ts` — clean
3. **Lint modified**: `npx eslint src/services/AppPersistence.ts` — only pre-existing warnings
4. **Import resolution**: Verify `AppServer.ts:18` import of `AuditLogFilters` resolves via AppPersistence re-export
5. **Interface completeness**: Verify `AppPersistenceService` now includes `getAuditLog` and `search` methods
6. **Repository pattern**: Each repository follows Context.Tag + Layer.effect pattern per CLAUDE.md
7. **Code style**: No semicolons, double quotes, 2-space indent — matches codebase conventions

## Files Changed

- `src/services/persistence/DatabaseManager.ts` — **NEW** — Context.Tag wrapping better-sqlite3 Database
- `src/services/persistence/AuditRepository.ts` — **NEW** — Audit log repository with logAudit + getAuditLog
- `src/services/persistence/TokenUsageRepository.ts` — **NEW** — Token usage repository with insertTokenUsage
- `src/services/persistence/SearchRepository.ts` — **NEW** — FTS5 search repository across 3 tables
- `src/services/AppPersistence.ts` — **MODIFIED** — Added imports, re-exports, interface methods, implementations for getAuditLog + search
