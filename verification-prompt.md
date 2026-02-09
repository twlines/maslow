# P3.3: Extract DocumentRepository

## Goals
Move document CRUD operations (getProjectDocuments, getProjectDocument, createProjectDocument, updateProjectDocument) from AppPersistence into a dedicated DocumentRepository module, following the same factory pattern used by ProjectRepository (P3.2) and ConversationRepository (P3.1).

## Acceptance Criteria

- [ ] `DocumentRepository.ts` exists with `createDocumentRepository(db)` factory function
- [ ] `AppProjectDocument` interface is defined in and exported from `DocumentRepository.ts`
- [ ] `AppPersistence.ts` re-exports `AppProjectDocument` from `DocumentRepository.ts`
- [ ] `AppPersistence.ts` delegates all 4 document methods to `documentRepo`
- [ ] Document prepared statements removed from AppPersistence `stmts` object
- [ ] No new type-check errors introduced (pre-existing errors unchanged)
- [ ] No new lint warnings/errors introduced
- [ ] All existing tests pass (68 pass, 8 skipped)

## Verification Steps

1. **Type-check**: `npm run type-check` — should produce same pre-existing errors only (no new errors)
2. **Lint**: `npm run lint` — no new warnings in changed files
3. **Tests**: `npm run test` — all 68 tests pass, 8 skipped
4. **Import check**: Verify `ThinkingPartner.ts` still imports `AppProjectDocument` from `AppPersistence.js` (re-export works)
5. **Pattern check**: Compare `DocumentRepository.ts` structure with `ProjectRepository` on branch `agent/claude/p3-2-extract-projectrepository-8fdfea9b` — should follow same factory + mapRow pattern

## Files Changed

- `src/services/DocumentRepository.ts` (new) — factory function with interface, prepared statements, mapRow, CRUD methods
- `src/services/AppPersistence.ts` (modified) — import + re-export, remove inline document stmts/implementations, delegate to documentRepo
