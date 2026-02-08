# Verification: Add FTS5 virtual tables for full-text search

## Card Title
Add FTS5 virtual tables for full-text search

## Goals
Add 3 FTS5 virtual tables to `AppPersistence.ts` schema initialization for full-text search across kanban cards, project documents, and decisions. Add triggers to keep the FTS indexes in sync with the source tables.

## Acceptance Criteria

- [ ] `kanban_cards_fts` FTS5 virtual table created with columns: `title`, `description`, content=kanban_cards, content_rowid=rowid
- [ ] `project_documents_fts` FTS5 virtual table created with columns: `title`, `content`, content=project_documents, content_rowid=rowid
- [ ] `decisions_fts` FTS5 virtual table created with columns: `title`, `description`, `reasoning`, content=decisions, content_rowid=rowid
- [ ] AFTER INSERT trigger on `kanban_cards` inserts into `kanban_cards_fts`
- [ ] AFTER DELETE trigger on `kanban_cards` deletes from `kanban_cards_fts`
- [ ] AFTER UPDATE trigger on `kanban_cards` deletes old + inserts new in `kanban_cards_fts`
- [ ] AFTER INSERT trigger on `project_documents` inserts into `project_documents_fts`
- [ ] AFTER DELETE trigger on `project_documents` deletes from `project_documents_fts`
- [ ] AFTER UPDATE trigger on `project_documents` deletes old + inserts new in `project_documents_fts`
- [ ] AFTER INSERT trigger on `decisions` inserts into `decisions_fts`
- [ ] AFTER DELETE trigger on `decisions` deletes from `decisions_fts`
- [ ] AFTER UPDATE trigger on `decisions` deletes old + inserts new in `decisions_fts`
- [ ] All virtual tables use `CREATE VIRTUAL TABLE IF NOT EXISTS`
- [ ] All triggers use `CREATE TRIGGER IF NOT EXISTS`
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] ESLint passes with no new errors (`npm run lint`)

## Verification Steps

1. **Build check**: Run `npm run build` — should compile with zero errors
2. **Lint check**: Run `npm run lint` — should show zero errors (warnings are pre-existing)
3. **Schema review**: Inspect `src/services/AppPersistence.ts` lines 295-380 for the FTS5 virtual tables and triggers
4. **Manual test**: Start the dev server (`npm run dev`), then:
   - Create a kanban card with a title containing a unique word
   - Query `SELECT * FROM kanban_cards_fts WHERE kanban_cards_fts MATCH 'unique_word'` via the SQLite CLI on `data/app.db`
   - Update the card's title; verify the FTS index reflects the update
   - Delete the card; verify the FTS index no longer contains the entry
   - Repeat for project_documents and decisions

## Files Changed

- `src/services/AppPersistence.ts` — Added FTS5 virtual table creation and sync triggers after main schema init
