# Verification: Add JWT token generation with expiry to auth endpoint

## Card Title
Add JWT token generation with expiry to auth endpoint

## Goals
Replace the static bearer token in AppServer.ts POST /api/auth/token with JWT generation. Update the auth middleware to verify JWTs. Keep backward compatibility with raw secret tokens.

## Acceptance Criteria

- [ ] `jsonwebtoken` and `@types/jsonwebtoken` are installed in package.json
- [ ] POST /api/auth/token generates a JWT with `{ sub: "maslow-user", iat, exp: now+24h }` when given a valid `{ token: "<secret>" }` body
- [ ] The JWT is signed with `config.appServer.authToken` as the secret
- [ ] POST /api/auth/token returns `{ ok: true, data: { token: "<jwt>" } }` on success
- [ ] POST /api/auth/token is exempt from the auth middleware (unauthenticated clients can call it)
- [ ] POST /api/auth/token returns 401 for invalid tokens and 400 for malformed bodies
- [ ] Auth middleware accepts JWT tokens in `Authorization: Bearer <jwt>` headers and verifies them
- [ ] Auth middleware still accepts the raw secret in `Authorization: Bearer <raw-secret>` (backward compat)
- [ ] Auth middleware returns false for expired JWTs
- [ ] No auth required when `authToken` is empty (dev mode preserved)
- [ ] TypeScript compiles cleanly (`tsc --noEmit`)
- [ ] ESLint passes with no new errors
- [ ] All existing tests pass

## Verification Steps

1. **Type check**: `npm run type-check` — should pass with no errors
2. **Lint**: `npm run lint` — should pass with no new errors (pre-existing warnings are OK)
3. **Tests**: `npm run test -- --run` — all 52 tests should pass
4. **Build**: `npm run build` — should compile cleanly
5. **Manual test (with server running)**:
   - Set `APP_SERVER_TOKEN=test-secret` in .env
   - POST to `/api/auth/token` with `{ "token": "test-secret" }` — should return a JWT
   - Use the returned JWT in `Authorization: Bearer <jwt>` header — should authenticate
   - Use raw secret in `Authorization: Bearer test-secret` header — should still authenticate (backward compat)
   - Use an invalid/expired JWT — should get 401
   - POST to `/api/auth/token` with `{ "token": "wrong" }` — should get 401

## Files Changed

- `src/services/AppServer.ts` — JWT import, updated `authenticate()` middleware, updated POST /api/auth/token handler
- `package.json` — added `jsonwebtoken` dependency
- `package-lock.json` — lockfile updated
