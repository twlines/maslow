# E1-E6: Write tests for clean services

## Goals
Add test files for services that are already well-structured but lack tests, using vitest with mocked dependencies.

## Acceptance Criteria

- [x] Kanban.test.ts covers board grouping, card movement, work queue ordering, createCardFromConversation title extraction
- [x] ThinkingPartner.test.ts covers decision logging, assumption append, state summary, context assembly
- [x] SteeringEngine.test.ts covers correction capture, query filtering, prompt block formatting
- [x] Persistence.test.ts already existed with comprehensive session CRUD and last active ordering tests
- [x] Voice.test.ts covers mock HTTP to whisper/chatterbox and isAvailable health checks
- [x] Telegram.test.ts covers message truncation utility and auth filtering behavior
- [x] All tests use vitest with mocked dependencies (no real databases or network calls)
- [x] All tests pass (71 new tests, 139 total including existing)
- [x] No lint errors or warnings in new test files
- [x] No new type-check errors introduced

## Verification Steps

1. Run the new test files:
   ```bash
   npx vitest run src/__tests__/services/Kanban.test.ts src/__tests__/services/ThinkingPartner.test.ts src/__tests__/services/SteeringEngine.test.ts src/__tests__/services/Voice.test.ts src/__tests__/services/Telegram.test.ts
   ```
   Expected: 71 tests pass across 5 files

2. Run the full test suite:
   ```bash
   npx vitest run
   ```
   Expected: 139 tests pass (8 skipped), 10 test files

3. Lint the new files:
   ```bash
   npx eslint src/__tests__/services/Kanban.test.ts src/__tests__/services/ThinkingPartner.test.ts src/__tests__/services/SteeringEngine.test.ts src/__tests__/services/Voice.test.ts src/__tests__/services/Telegram.test.ts
   ```
   Expected: No errors or warnings

## Files Changed

- `src/__tests__/services/Kanban.test.ts` (new, 20 tests)
- `src/__tests__/services/ThinkingPartner.test.ts` (new, 15 tests)
- `src/__tests__/services/SteeringEngine.test.ts` (new, 14 tests)
- `src/__tests__/services/Voice.test.ts` (new, 9 tests)
- `src/__tests__/services/Telegram.test.ts` (new, 13 tests)
- `verification-prompt.md` (new)

## Test Coverage Summary

| Service | Tests | Key Scenarios |
|---------|-------|---------------|
| Kanban | 20 | Board grouping by column, position sorting, card movement with audit logging, title extraction from conversation text (truncation, sentence boundaries), work queue (getNext, startWork, completeWork, skipToBack), resume with context |
| ThinkingPartner | 15 | Decision creation and retrieval, assumption append (new doc vs existing doc), state summary upsert, project context assembly (project + docs + decisions, 10-decision limit) |
| SteeringEngine | 14 | Correction capture with domains/sources, query filtering, deactivate/reactivate lifecycle, prompt block formatting (domain grouping, human-readable labels, mandatory instruction text) |
| Voice | 9 | Transcription via mocked fetch to whisper, synthesis request formatting, isAvailable health checks (both up, both down, mixed) |
| Telegram | 13 | truncateMessage utility (under/at/over limit, custom limit, empty string, unicode), message interface validation, auth filtering logic |
