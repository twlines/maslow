# Verification: Add optimistic locking to card updates via updated_at

## Card Title
Add optimistic locking to card updates via updated_at

## Goals
Prevent silent overwrites when two clients concurrently edit the same kanban card. The `PUT /api/projects/:id/cards/:cardId` handler now accepts an optional `if_updated_at` field in the request body. When provided, the server checks the card's current `updated_at` timestamp against the supplied value before proceeding with the update.

## Acceptance Criteria

- [ ] The PUT handler accepts an optional `if_updated_at` field in the request body
- [ ] When `if_updated_at` is **not** provided, the handler behaves exactly as before (backward compatible)
- [ ] When `if_updated_at` is provided and **matches** the card's current `updatedAt`, the update proceeds normally (200 response)
- [ ] When `if_updated_at` is provided and **does not match** the card's current `updatedAt`, the server returns 409 Conflict with `{ok: false, error: "Card was modified by another client", currentUpdatedAt: <actual>}`
- [ ] When `if_updated_at` is provided but the card does not exist, the server returns 404 with `{ok: false, error: "Card not found"}`
- [ ] No new lint errors or type-check failures introduced

## Verification Steps

### 1. Type-check and lint
```bash
npm run type-check
npm run lint
```
Expect: 0 errors (pre-existing warnings are acceptable)

### 2. Manual API testing (requires running server)

**Create a test card:**
```bash
curl -X POST http://localhost:3000/api/projects/<PROJECT_ID>/cards \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Card","description":"Testing optimistic locking"}'
```
Note the returned card's `updatedAt` value.

**Update without if_updated_at (backward compat):**
```bash
curl -X PUT http://localhost:3000/api/projects/<PROJECT_ID>/cards/<CARD_ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Title"}'
```
Expect: 200 OK

**Update with matching if_updated_at:**
```bash
# First, get the card to find its current updatedAt
curl http://localhost:3000/api/projects/<PROJECT_ID>/cards
# Then update with matching timestamp
curl -X PUT http://localhost:3000/api/projects/<PROJECT_ID>/cards/<CARD_ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Again","if_updated_at":<CURRENT_UPDATED_AT>}'
```
Expect: 200 OK

**Update with stale if_updated_at:**
```bash
curl -X PUT http://localhost:3000/api/projects/<PROJECT_ID>/cards/<CARD_ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"Stale Update","if_updated_at":1000}'
```
Expect: 409 Conflict with `{"ok":false,"error":"Card was modified by another client","currentUpdatedAt":<actual>}`

**Update nonexistent card with if_updated_at:**
```bash
curl -X PUT http://localhost:3000/api/projects/<PROJECT_ID>/cards/nonexistent-id \
  -H "Content-Type: application/json" \
  -d '{"title":"Ghost","if_updated_at":1000}'
```
Expect: 404 Not Found with `{"ok":false,"error":"Card not found"}`

## Files Changed
- `src/services/AppServer.ts` — Added optimistic locking check in the PUT `/api/projects/:id/cards/:cardId` handler (lines 289-303)
