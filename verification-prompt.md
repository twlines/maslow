# P3.5: Extract DecisionRepository

## Goals
Move decision CRUD operations (getDecisions, getDecision, createDecision, updateDecision) from AppPersistence into a dedicated DecisionRepository service following the Context.Tag + Layer.effect pattern.

## Acceptance Criteria

- [x] `DecisionRepository.ts` created at `src/services/DecisionRepository.ts`
- [x] Service follows Context.Tag + Layer.scoped pattern with Effect.addFinalizer
- [x] Contains: AppDecision type, DecisionRepositoryService interface, DecisionRepository tag, DecisionRepositoryLive layer
- [x] Owns decision table schema, FTS5 virtual table, FTS triggers, prepared statements, and row mapper
- [x] AppPersistence delegates getDecisions/getDecision/createDecision/updateDecision to DecisionRepository
- [x] AppPersistence re-exports AppDecision type for backward compatibility
- [x] DecisionRepository wired into layer composition in index.ts
- [x] No new type-check errors introduced (all errors are pre-existing)
- [x] No new lint errors introduced (all warnings are pre-existing)
- [x] All 68 existing tests pass

## Verification Steps

1. Run `npm run type-check` -- all errors should be pre-existing (HeartbeatLayer duplicate, AuditLogFilters missing, search/getAuditLog/backupDatabase missing)
2. Run `npm run lint` -- no new warnings in changed files
3. Run `npm run test` -- all 68 tests pass, 8 skipped (pre-existing)
4. Verify `AppDecision` type is re-exported from AppPersistence for backward compatibility
5. Verify consumers (ThinkingPartner, AppServer, AgentOrchestrator) continue to import from AppPersistence without changes

## Files Changed

- `src/services/DecisionRepository.ts` (NEW) -- extracted repository service
- `src/services/AppPersistence.ts` (MODIFIED) -- removed decision implementation, delegates to DecisionRepository
- `src/index.ts` (MODIFIED) -- wired DecisionRepositoryLive into layer composition
