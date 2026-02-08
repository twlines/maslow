# B14: Write Persistence Repository Tests

## Goals
Test the AppPersistence service thoroughly with isolated in-memory SQLite databases.
Organize tests by logical repository domain. Cover happy path, not-found, and edge cases.
Verify encryption round-trip for messages, FTS5 indexing for search, and kanban ordering/work queue priority.

## Acceptance Criteria

- [x] Test file per logical repository domain in `src/__tests__/services/persistence/`
- [x] In-memory/temp SQLite (file-backed with temp dirs, cleaned up after each test) for isolation
- [x] MessageRepository: save/get, encryption round-trip (including unicode/emoji), metadata, pagination, null projectId
- [x] ConversationRepository: create, getActive, update session/context, archive, getRecent, incrementMessageCount
- [x] ProjectRepository: project CRUD, project document CRUD, decision CRUD with JSON alternatives
- [x] KanbanRepository: card CRUD, position auto-increment, moveCard, work queue (getNextCard, startCard, completeCard, skipCardToBack), agent assignment, context snapshots
- [x] SearchRepository: FTS5 trigger verification for kanban_cards, project_documents, decisions (insert/update/delete)
- [x] SteeringRepository: addCorrection, getCorrections (domain/project/activeOnly filters), deactivate/reactivate/delete
- [x] AuditAndUsageRepository: logAudit, insertTokenUsage, getUsageSummary (aggregation, filtering, time windows)
- [x] All 103 tests pass
- [x] No new lint warnings in test files
- [x] No new TypeScript errors (pre-existing errors in src/index.ts and src/services/AppServer.ts are unrelated)

## Verification Steps

1. Run persistence tests: `npx vitest run src/__tests__/services/persistence/`
2. Run all tests: `npx vitest run`
3. Check lint: `npm run lint 2>&1 | grep "persistence/"` (should show no results)
4. Check type errors: `npm run type-check 2>&1 | grep "persistence/"` (should show no results)

## Files Changed

### New Files (8)
- `src/__tests__/services/persistence/test-helpers.ts` — Shared test infrastructure (createTempDir, cleanupTempDir, createTestLayer, runWithAppPersistence)
- `src/__tests__/services/persistence/MessageRepository.test.ts` — 11 tests: save/get, encryption round-trip, metadata, pagination, projectId filtering
- `src/__tests__/services/persistence/ConversationRepository.test.ts` — 12 tests: lifecycle, session updates, archiving, ordering
- `src/__tests__/services/persistence/ProjectRepository.test.ts` — 22 tests: project/document/decision CRUD
- `src/__tests__/services/persistence/KanbanRepository.test.ts` — 25 tests: CRUD, ordering, work queue, agent assignment
- `src/__tests__/services/persistence/SearchRepository.test.ts` — 9 tests: FTS5 trigger verification across 3 content types
- `src/__tests__/services/persistence/SteeringRepository.test.ts` — 12 tests: correction CRUD with filter combinations
- `src/__tests__/services/persistence/AuditAndUsageRepository.test.ts` — 12 tests: audit log, token usage, usage summary aggregation
