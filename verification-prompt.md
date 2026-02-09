# P4.1: Unit tests for extracted repositories

## Goals
Write unit tests for each repository domain in AppPersistence, covering CRUD operations, edge cases, encryption round-trip, and work queue logic.

## Acceptance Criteria

- [x] ConversationRepository.test.ts — 19 tests covering conversation lifecycle, message encryption round-trip, unicode content, metadata, pagination
- [x] ProjectRepository.test.ts — 11 tests covering CRUD, status transitions, agent config fields, color, multi-field updates
- [x] DocumentRepository.test.ts — 9 tests covering all 6 document types, project isolation, large content, title/content updates
- [x] CardRepository.test.ts — 26 tests covering full work queue lifecycle (create → assign → start → complete), priority ordering, skipToBack, agent assignment, context snapshots, position auto-increment
- [x] DecisionRepository.test.ts — 12 tests covering CRUD, JSON alternatives round-trip, project isolation, revisedAt tracking
- [x] SteeringRepository.test.ts — 14 tests covering all domain/source types, active/inactive filtering, domain+project compound filters, deactivate/reactivate/delete lifecycle
- [x] All 91 new tests pass (171 total including existing)
- [x] Zero lint errors on new test files
- [x] Pre-existing type-check errors in src/index.ts and src/services/AppServer.ts are unrelated to this change

## Verification Steps

1. Run tests: `npm run test` — expect 171 passed, 8 skipped
2. Lint new files: `npx eslint src/__tests__/services/{Card,Conversation,Decision,Document,Project,Steering}Repository.test.ts` — expect 0 errors, 0 warnings
3. Verify encryption round-trip: ConversationRepository tests save messages through encrypt() and retrieve through decrypt(), including unicode content
4. Verify work queue logic: CardRepository tests the full create → getNextCard → assignAgent → startCard → completeCard flow, plus skipCardToBack priority reordering

## Files Changed

- `src/__tests__/services/CardRepository.test.ts` (new)
- `src/__tests__/services/ConversationRepository.test.ts` (new)
- `src/__tests__/services/DecisionRepository.test.ts` (new)
- `src/__tests__/services/DocumentRepository.test.ts` (new)
- `src/__tests__/services/ProjectRepository.test.ts` (new)
- `src/__tests__/services/SteeringRepository.test.ts` (new)
- `verification-prompt.md` (new)
