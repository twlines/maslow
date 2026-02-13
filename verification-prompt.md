# P3.6: Extract SteeringRepository

## Goals

Extract steering corrections, audit log, token usage, usage summary, and full-text search from AppPersistence into a dedicated SteeringRepository module. AppPersistence becomes a thin facade that delegates to the repository.

## Acceptance Criteria

- [x] `SteeringRepository.ts` exists with factory function `createSteeringRepository(db)`
- [x] All 5 steering correction methods extracted: `addCorrection`, `getCorrections`, `deactivateCorrection`, `reactivateCorrection`, `deleteCorrection`
- [x] `logAudit` extracted to SteeringRepository
- [x] `getAuditLog` implemented (was missing, now works with `AuditLogFilters`)
- [x] `insertTokenUsage` extracted to SteeringRepository
- [x] `getUsageSummary` extracted to SteeringRepository
- [x] `search` implemented via FTS5 (was missing, now queries kanban_cards_fts, project_documents_fts, decisions_fts)
- [x] `AuditLogFilters`, `AuditLogEntry`, `SearchResult` types defined and re-exported from AppPersistence
- [x] `backupDatabase` added to AppPersistenceService interface (was missing, causing compile error)
- [x] AppPersistence delegates all extracted methods to SteeringRepository
- [x] Prepared statements moved from AppPersistence to SteeringRepository
- [x] Type-check passes (`npx tsc --noEmit` — only pre-existing index.ts errors remain)
- [x] Lint passes (`npx eslint` — only pre-existing warnings remain)
- [x] No changes to SteeringEngine, Kanban, AgentOrchestrator, or AppServer needed (all imports resolve)

## Verification Steps

1. Run `npx tsc --noEmit` — should show only pre-existing index.ts errors (duplicate Heartbeat import, HeartbeatLayer redeclaration)
2. Run `npx eslint src/services/SteeringRepository.ts src/services/AppPersistence.ts` — should show zero errors (only pre-existing `any` warnings in AppPersistence)
3. Verify `SteeringEngine.ts` still compiles — it imports from `AppPersistence.js` which still exports `CorrectionDomain`, `CorrectionSource`, `SteeringCorrection`
4. Verify `AppServer.ts` still compiles — `AuditLogFilters` is re-exported from `AppPersistence.js`
5. Verify `Kanban.ts` and `AgentOrchestrator.ts` still compile — they call `db.logAudit()` and `db.insertTokenUsage()` which are now delegated

## Files Changed

- `src/services/SteeringRepository.ts` (NEW) — factory function with all extracted methods
- `src/services/AppPersistence.ts` (MODIFIED) — imports repository, delegates methods, adds missing interface methods
