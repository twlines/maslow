# P2.2: Fix 4 any violations in AppServer

## Goals
Eliminate all `@typescript-eslint/no-explicit-any` warnings and the `no-unused-vars` warning in `src/services/AppServer.ts`.

## Acceptance Criteria

- [ ] `npx eslint src/services/AppServer.ts` produces 0 warnings and 0 errors
- [ ] No `any` type annotations remain in AppServer.ts (excluding third-party type definitions)
- [ ] No `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments remain
- [ ] All WebSocket parameters are typed as `import("ws").WebSocket` or the extended `TrackedWebSocket` interface
- [ ] The `wss` variable is typed as `WsServer | null` instead of `any`
- [ ] The `clients` Set is typed as `Set<TrackedWebSocket>` instead of `Set<any>`
- [ ] The `clientSubscriptions` Map uses `TrackedWebSocket` as key type
- [ ] The unused `projectId` destructuring on the doc match route is fixed
- [ ] No new TypeScript errors are introduced by these changes (pre-existing errors in other files are unrelated)

## Verification Steps

1. Run `npx eslint src/services/AppServer.ts` — expect 0 problems
2. Run `npx tsc --noEmit 2>&1 | grep AppServer` — expect only pre-existing errors (AuditLogFilters import, search/getAuditLog/backupDatabase methods)
3. Search for `any` in AppServer.ts — should only appear in comments or string literals, not type annotations
4. Search for `eslint-disable.*no-explicit-any` — should return 0 matches

## Files Changed

- `src/services/AppServer.ts` — replaced all `any` type annotations with proper ws types
