# Verification: Add GET /api/projects/:id/export for Markdown export

## Card Title
Add GET /api/projects/:id/export for Markdown export

## Goals
Add a REST endpoint that exports all project data as a single downloadable Markdown document.

## Acceptance Criteria

- [ ] `GET /api/projects/:id/export` returns a Markdown document
- [ ] Returns 404 with JSON error if project not found
- [ ] Markdown includes `# Project Name` header with description
- [ ] Markdown includes `## Kanban Board` with `### Backlog`, `### In Progress`, `### Done` subsections
- [ ] Cards are rendered as bullet lists with title and description
- [ ] Empty columns show `_No items_` placeholder
- [ ] Markdown includes `## Decisions` with each decision's title, description, reasoning, alternatives, and tradeoffs
- [ ] Markdown includes `## Documents` with each document's title and content
- [ ] Markdown includes `## Recent Conversations` with date, message count, status, and summary preview
- [ ] Response has `Content-Type: text/markdown; charset=utf-8`
- [ ] Response has `Content-Disposition: attachment; filename="<project_name>_export.md"`
- [ ] Filename sanitizes special characters (replaces non-alphanumeric with `_`)
- [ ] CORS headers are included in the response
- [ ] Route constant added to `packages/shared/src/api/index.ts`

## Verification Steps

1. **Type check**: Run `npm run type-check` — should pass with no errors
2. **Lint**: Run `npm run lint` — should show 0 errors (warnings are pre-existing)
3. **Manual test**: Start the server (`npm run dev`), create a project with cards/decisions/docs, then `curl http://localhost:3117/api/projects/<id>/export` — should receive a Markdown file
4. **404 test**: `curl http://localhost:3117/api/projects/nonexistent/export` — should return `{"ok":false,"error":"Project not found"}`
5. **Headers check**: Verify `Content-Type` is `text/markdown` and `Content-Disposition` is set to `attachment`

## Files Changed

- `src/services/AppServer.ts` — Added `GET /api/projects/:id/export` route handler
- `packages/shared/src/api/index.ts` — Added `PROJECT_EXPORT` route constant
- `verification-prompt.md` — This file
