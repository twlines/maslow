# P3.8: Extract auth middleware from AppServer

## Goals
Extract JWT validation, token generation, and auth checking into `src/services/auth/AuthMiddleware.ts` as pure functions. AppServer imports and wires as middleware.

## Acceptance Criteria

- [x] `src/services/auth/AuthMiddleware.ts` exists with pure functions:
  - `extractBearerToken(header)` — extracts token from "Bearer <token>" header
  - `validateToken(token, secret)` — verifies JWT, returns payload or null
  - `generateToken(secret, expirySeconds?)` — signs JWT, returns `{ token, expiresAt }`
  - `authenticateRequest(req, authToken, port)` — full request auth check (header + query param)
- [x] Constants `AUTH_TOKEN_HEADER` and `JWT_EXPIRY_SECONDS` exported from AuthMiddleware
- [x] AppServer imports and uses these functions instead of inline auth code
- [x] `jwt` (jsonwebtoken) import removed from AppServer — only used in AuthMiddleware
- [x] No new type errors introduced (pre-existing errors in index.ts and AppPersistence unchanged)
- [x] No new lint errors or warnings introduced
- [x] All existing tests pass (68 passed, 8 skipped)

## Verification Steps

1. `npm run type-check` — should show only pre-existing errors (index.ts duplicates, AppPersistence missing members)
2. `npx eslint src/services/auth/AuthMiddleware.ts` — should pass clean
3. `npx vitest run` — all tests should pass
4. Review `src/services/auth/AuthMiddleware.ts` for:
   - Pure functions with no side effects
   - Proper error handling (try/catch in validateToken)
   - Correct JWT signing with configurable expiry
5. Review `src/services/AppServer.ts` for:
   - Auth functions replaced with imports from AuthMiddleware
   - No remaining direct `jwt.` usage
   - `/api/auth/token` and `/api/auth/refresh` endpoints use extracted functions

## Files Changed

- `src/services/auth/AuthMiddleware.ts` (NEW) — Pure auth functions extracted from AppServer
- `src/services/AppServer.ts` (MODIFIED) — Replaced inline auth code with AuthMiddleware imports
