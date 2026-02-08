# Verification: Add search method and GET /api/search endpoint

## Card Title
Add search method and GET /api/search endpoint

## Goals
- Add `search(query, projectId?)` method to `AppPersistence` that queries 3 FTS5 tables (messages, kanban_cards, project_documents) using MATCH, unions results with source_type labels, orders by rank, limits to 50
- Add `GET /api/search?q=term&project_id=X` endpoint in `AppServer.ts` returning `{results: [{type, id, title, snippet, projectId}]}`

## Acceptance Criteria

- [ ] Three FTS5 virtual tables created: `messages_fts`, `kanban_cards_fts`, `project_documents_fts`
- [ ] FTS tables are populated from existing data on first startup (idempotent)
- [ ] FTS tables are kept in sync on insert/update/delete of source records
- [ ] Encrypted message content is decrypted before FTS indexing
- [ ] `SearchResult` interface exported from `AppPersistence.ts` with fields: `type`, `id`, `title`, `snippet`, `projectId`
- [ ] `search(query, projectId?)` method added to `AppPersistenceService` interface
- [ ] Search implementation queries all 3 FTS5 tables, returns union of results, limits to 50
- [ ] Optional `projectId` parameter filters results to a single project
- [ ] `GET /api/search?q=term&project_id=X` endpoint returns `{ ok: true, data: { results: [...] } }`
- [ ] Returns 400 if `q` parameter is missing
- [ ] `SEARCH` route constant added to `packages/shared/src/api/index.ts`
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with no new warnings/errors (`npm run lint`)

## Verification Steps

1. **Type check**: `npm run type-check` should pass with no errors
2. **Lint**: `npm run lint` should show no new errors (pre-existing warnings are acceptable)
3. **Schema verification**: Start the server (`npm run dev`) and verify the FTS5 tables are created in `data/app.db`:
   ```sql
   sqlite3 data/app.db ".tables" | grep fts
   ```
4. **API test**: With the server running, test the search endpoint:
   ```bash
   # Should return 400 (missing q param)
   curl http://localhost:3117/api/search

   # Should return results (empty or populated)
   curl "http://localhost:3117/api/search?q=test"

   # Should filter by project
   curl "http://localhost:3117/api/search?q=test&project_id=some-project-id"
   ```
5. **FTS sync verification**: Create a card via API, then search for it:
   ```bash
   curl -X POST http://localhost:3117/api/projects/PROJECT_ID/cards \
     -H "Content-Type: application/json" \
     -d '{"title":"Unique Test Card XYZ","description":"Searchable description"}'

   curl "http://localhost:3117/api/search?q=Unique%20Test%20Card"
   ```

## Files Changed

- `src/services/AppPersistence.ts` - Added `SearchResult` interface, `search()` method, FTS5 table creation, FTS sync on mutations, FTS population on startup
- `src/services/AppServer.ts` - Added `GET /api/search` endpoint
- `packages/shared/src/api/index.ts` - Added `SEARCH` route constant
- `verification-prompt.md` - This file
