# C1-C2: Extract server router + auth

## Goals
- Create `src/services/server/router.ts` — declarative route table replacing 50+ regex matches in handleRequest
- Create `src/services/server/auth.ts` — `authenticate()`, `signJwt()`, `verifyJwt()`, JWT constants
- Move auth token + refresh endpoint handlers to auth.ts
- Wire new modules into AppServer.ts

## Acceptance Criteria

- [ ] `src/services/server/router.ts` exists with:
  - `Route` interface: `{ method, pattern, handler, paramNames? }`
  - `RouteHandler` type with `(req, res, ctx)` signature
  - `RouteContext` with `params`, `searchParams`, `path`, `method`
  - `createRouter(routes, baseUrl)` returning `(req, res) => Promise<boolean>`
  - `extractParams()` utility for regex capture groups
  - `sendJson()`, `readBody()`, `readBodyRaw()` helpers (moved from AppServer)
- [ ] `src/services/server/auth.ts` exists with:
  - `AUTH_TOKEN_HEADER`, `JWT_EXPIRY_SECONDS` constants
  - `signJwt(secret)` — signs JWT with `{ sub: "maslow" }`
  - `verifyJwt(token, secret)` — verifies JWT, returns payload or null
  - `authenticate(req, authToken, baseUrl)` — 3-tier auth (dev mode / bearer / query param)
  - `handleAuthToken(req, res, authToken)` — POST /api/auth/token handler
  - `handleAuthRefresh(req, res, authToken, authHeader)` — POST /api/auth/refresh handler
- [ ] `AppServer.ts` imports from new modules instead of inline definitions
- [ ] `AppServer.ts` uses declarative `routes: Route[]` array instead of sequential if/regex chain
- [ ] `handleRequest` uses `createRouter()` to match routes
- [ ] Auth-exempt routes (`/api/health`, `/api/auth/token`) skip authentication
- [ ] Duplicate auth/token handler (bug #1) is fixed — single handler with consistent response shape
- [ ] No new TypeScript errors introduced (pre-existing errors preserved)
- [ ] No new ESLint errors or warnings introduced
- [ ] Route ordering handles ambiguous patterns correctly (e.g. `/cards/next` before `/cards/:cardId`)

## Verification Steps

1. **TypeScript compilation**: `npx tsc --noEmit` should produce same errors as base branch (11 pre-existing)
2. **ESLint**: `npx eslint src/services/server/router.ts src/services/server/auth.ts src/services/AppServer.ts` — 0 errors, only pre-existing `any` warnings
3. **Route count**: Verify all ~50 routes from the original handler are present in the route table
4. **Auth flow**: Trace auth token and refresh handlers — they should delegate to `auth.ts`
5. **WebSocket auth**: Verify `authenticate()` is called with correct 3-arg signature in WS handler
6. **Parameter extraction**: Verify routes with path params use `paramNames` and `params.*` in handlers

## Files Changed

- `src/services/server/router.ts` — **NEW** — Declarative route table and utilities
- `src/services/server/auth.ts` — **NEW** — JWT auth functions and endpoint handlers
- `src/services/AppServer.ts` — **MODIFIED** — Rewired to use router + auth modules
