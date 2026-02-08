# Verification: Add POST /api/auth/refresh endpoint for token renewal

## Card Title
Add POST /api/auth/refresh endpoint for token renewal

## Goals
- Add `POST /api/auth/refresh` to AppServer.ts
- Accept a valid (but possibly near-expiry) JWT in the Authorization header
- Verify it with jsonwebtoken, and if valid, issue a new JWT with a fresh 24h expiry
- Return `{ token: "new.jwt.token", expiresAt: timestamp }`
- Reject expired tokens (client must re-authenticate with the raw secret)

## Acceptance Criteria

- [ ] `POST /api/auth/token` now returns `{ authenticated: true, token, expiresAt }` with a signed JWT
- [ ] `POST /api/auth/refresh` accepts a valid JWT in `Authorization: Bearer <jwt>` and returns `{ token, expiresAt }`
- [ ] `POST /api/auth/refresh` rejects expired JWTs with 401 and `{ ok: false, error: "Invalid or expired token" }`
- [ ] `POST /api/auth/refresh` rejects missing/malformed Authorization headers with 401
- [ ] The `authenticate()` middleware accepts both raw static tokens and valid JWTs
- [ ] JWTs are signed using the `APP_SERVER_TOKEN` env var as the HMAC secret
- [ ] JWT expiry is 24 hours
- [ ] `jsonwebtoken` is added as a dependency
- [ ] `AUTH_REFRESH` route constant is added to `packages/shared/src/api/index.ts`
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint reports no new errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Verification Steps

1. **Type check**: `npm run type-check` should pass with no errors
2. **Lint**: `npm run lint` should report 0 errors (warnings are pre-existing)
3. **Build**: `npm run build` should succeed
4. **Manual test (login + refresh)**:
   ```bash
   # Set APP_SERVER_TOKEN=mysecret in .env, then start server

   # Step 1: Authenticate with raw secret -> get JWT
   curl -X POST http://localhost:3117/api/auth/token \
     -H "Content-Type: application/json" \
     -d '{"token":"mysecret"}'
   # Expected: { ok: true, data: { authenticated: true, token: "eyJ...", expiresAt: 1234567890 } }

   # Step 2: Refresh the JWT
   curl -X POST http://localhost:3117/api/auth/refresh \
     -H "Authorization: Bearer eyJ..."
   # Expected: { ok: true, data: { token: "eyJ...(new)...", expiresAt: 1234567891 } }

   # Step 3: Use JWT for authenticated endpoints
   curl http://localhost:3117/api/projects \
     -H "Authorization: Bearer eyJ..."
   # Expected: { ok: true, data: [...] }

   # Step 4: Use expired/invalid JWT
   curl -X POST http://localhost:3117/api/auth/refresh \
     -H "Authorization: Bearer invalid.token.here"
   # Expected: { ok: false, error: "Invalid or expired token" }
   ```

## Files Changed

- `src/services/AppServer.ts` — Added JWT import, `signJwt()`/`verifyJwt()` helpers, updated `authenticate()` to accept JWTs, enhanced `/api/auth/token` to return JWT, added `/api/auth/refresh` endpoint
- `packages/shared/src/api/index.ts` — Added `AUTH_REFRESH` route constant
- `package.json` — Added `jsonwebtoken` dependency and `@types/jsonwebtoken` dev dependency
- `package-lock.json` — Updated lock file
