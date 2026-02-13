# Verification: P3.4 — Extract CardRepository

## Card Title & Goals
Extract all kanban card data access methods from AppPersistence into a dedicated CardRepository module. This is the largest extraction — owns work queue logic (getNextCard, skipCardToBack, etc.).

## Acceptance Criteria
- [x] New `src/services/CardRepository.ts` module created
- [x] All 13 card methods extracted: getCards, getCard, createCard, updateCard, deleteCard, moveCard, getNextCard, saveCardContext, assignCardAgent, updateCardAgentStatus, startCard, completeCard, skipCardToBack
- [x] Card-specific prepared statements moved to CardRepository
- [x] `mapCardRow` helper moved to CardRepository (with proper types instead of `any`)
- [x] `skipCardToBack` inline `db.prepare()` replaced with a proper prepared statement (`skipCardSetPriority`)
- [x] AppPersistence delegates all card methods to CardRepository via `createCardRepository(db)`
- [x] Card-related prepared statements removed from AppPersistence's `stmts` object
- [x] All existing type exports (`AppKanbanCard`, `AgentType`, `AgentStatus`) remain in AppPersistence
- [x] No changes needed to downstream consumers (Kanban.ts, AppServer.ts, etc.)
- [x] Type-check passes (no new errors introduced)
- [x] Lint passes (no new warnings introduced)
- [x] All existing tests pass (68 passed, 8 skipped)

## Verification Steps
1. Run `npm run type-check` — all errors should be pre-existing (index.ts duplicates, AppServer missing members)
2. Run `npm run lint` — 0 errors, warnings should not include CardRepository.ts
3. Run `npm test -- --run` — all 68 tests pass
4. Review `src/services/CardRepository.ts` — contains `CardRepositoryMethods` interface, `mapCardRow` helper, `createCardRepository` factory function with all 13 methods
5. Review `src/services/AppPersistence.ts` — imports `createCardRepository`, creates `cardRepo` instance, delegates all card methods
6. Verify no callers changed — `Kanban.ts`, `AppServer.ts`, `Heartbeat.ts`, `AgentOrchestrator.ts`, `SessionManager.ts` remain untouched

## Files Changed
- `src/services/CardRepository.ts` — **NEW** — Card repository module (223 lines)
- `src/services/AppPersistence.ts` — **MODIFIED** — Import CardRepository, delegate card methods, remove card stmts and mapCardRow
