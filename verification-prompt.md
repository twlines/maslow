# P4.2: Unit tests for route handlers

## Goals
Write unit tests for each handler group extracted from AppServer.ts:
- routes/projects.test.ts
- routes/cards.test.ts
- routes/decisions.test.ts
- routes/documents.test.ts

Test request parsing, response shape, error cases with mock deps.

## Acceptance Criteria

- [x] 1 test file per handler group (projects, cards, decisions, documents)
- [x] Route handler functions extracted into `src/routes/` as testable units
- [x] Mock dependencies (AppPersistence, Kanban, ThinkingPartner) used in tests
- [x] Request parsing validated (missing fields return 400)
- [x] Response shape validated (correct status codes, `{ ok, data/error }` envelope)
- [x] Error cases covered (404 not found, 409 conflict, 500 internal errors)
- [x] All tests passing (56 tests across 4 files)
- [x] No lint errors in new files
- [x] No type errors in new files

## Verification Steps

1. Run tests:
   ```bash
   npx vitest run src/__tests__/routes/
   ```
   Expected: 56 tests passing across 4 files

2. Lint new files:
   ```bash
   npx eslint src/routes/ src/__tests__/routes/
   ```
   Expected: No errors

3. Type-check new files (note: pre-existing errors in other files):
   ```bash
   npx tsc --noEmit 2>&1 | grep "src/routes/"
   ```
   Expected: No output (no errors)

## Files Changed

### New Files
- `src/routes/shared.ts` - Shared `sendJson` utility for route handlers
- `src/routes/projects.ts` - Project CRUD route handlers
- `src/routes/cards.ts` - Kanban card CRUD and work queue route handlers
- `src/routes/decisions.ts` - Decision journal and project context route handlers
- `src/routes/documents.ts` - Project document CRUD route handlers
- `src/__tests__/routes/route-test-utils.ts` - Mock factories for ServerResponse, services, and data builders
- `src/__tests__/routes/projects.test.ts` - 10 tests for project routes
- `src/__tests__/routes/cards.test.ts` - 22 tests for card routes
- `src/__tests__/routes/decisions.test.ts` - 10 tests for decision routes
- `src/__tests__/routes/documents.test.ts` - 14 tests for document routes

### Test Coverage
- **Projects**: GET all, POST create, GET by ID, PUT update, 404 not found, 400 missing name, 500 errors
- **Cards**: GET board, POST create, PUT update, DELETE, GET next, POST context/skip/assign/start/complete, GET resume, 400 validation, 404 not found, 409 optimistic lock conflict
- **Decisions**: GET all, POST create, GET project context, 400 missing title, 500 errors, default field values
- **Documents**: GET all, POST create, GET by ID, PUT update, 404 not found, 400 missing fields, 500 errors
