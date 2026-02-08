# Verification: Implement priority ordering in kanban getNext

## Card Title
Implement priority ordering in kanban getNext

## Goals
Verify that `getNext()` in `Kanban.ts` orders by `priority ASC, position ASC` (lower priority number = higher urgency). Confirm the `priority` column exists on `kanban_cards` and the SQL is correct.

## Acceptance Criteria

- [x] `getNextCard` prepared statement orders by `priority ASC, position ASC`
- [x] The `priority` column exists on `kanban_cards` (via migration)
- [x] `priority` defaults to `0` for new cards
- [x] `Kanban.getNext()` delegates to `db.getNextCard()`
- [x] An index covers the priority-based query (`idx_kanban_priority`)
- [x] `skipCardToBack` sets priority = max + 1 (pushes skipped cards to end of queue)
- [x] `mapCardRow` handles null priority gracefully (`r.priority ?? 0`)

## Verification Steps

1. Read `src/services/AppPersistence.ts` lines 404-409 — confirm `getNextCard` SQL:
   ```sql
   SELECT * FROM kanban_cards
   WHERE project_id = ? AND "column" = 'backlog'
   ORDER BY priority ASC, position ASC
   LIMIT 1
   ```
2. Read `src/services/Kanban.ts` line 123 — confirm `getNext` delegates to `db.getNextCard(projectId)`
3. Read migration at `AppPersistence.ts` line 309 — confirm `priority INTEGER NOT NULL DEFAULT 0`
4. Read index at `AppPersistence.ts` line 318 — confirm `idx_kanban_priority` on `(project_id, "column", priority, position)`
5. Run `npm run type-check` to confirm no type errors
6. Run `npm run lint` to confirm no lint errors
7. Run `npm run test` to confirm all tests pass

## Files Changed

- `verification-prompt.md` — this file (created)

## Notes

No code changes were required. The existing implementation already correctly orders by `priority ASC, position ASC`. The deep research protocol confirmed all components are correctly wired:
- SQL ordering is correct
- Column exists with proper default
- Index supports the query
- Interface types match
- Edge cases (null priority, skipToBack) are handled
