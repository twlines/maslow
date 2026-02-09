# P3.7: Extract parseWorkspaceActions + prompt to own module

## Goals
Move `parseWorkspaceActions`, `WORKSPACE_ACTIONS_PROMPT`, and `WorkspaceAction` interface from `AppServer.ts` to a dedicated `src/services/protocols/WorkspaceActions.ts` module. Update all imports.

## Acceptance Criteria

- [x] `src/services/protocols/WorkspaceActions.ts` exists with:
  - `WorkspaceAction` interface (exported)
  - `WORKSPACE_ACTIONS_PROMPT` constant (exported)
  - `VALID_ACTION_TYPES` set (internal)
  - `parseWorkspaceActions()` function (exported)
- [x] `AppServer.ts` no longer defines these — imports from `./protocols/WorkspaceActions.js`
- [x] `SessionManager.ts` imports from `./protocols/WorkspaceActions.js` instead of `./AppServer.js`
- [x] `parseWorkspaceActions.test.ts` imports from `../../services/protocols/WorkspaceActions.js`
- [x] All 16 tests in `parseWorkspaceActions.test.ts` pass
- [x] No new type-check errors introduced (pre-existing errors unrelated to this change)
- [x] No new lint errors introduced

## Verification Steps

1. **Type-check:** `npm run type-check` — confirm no new errors related to `WorkspaceAction`, `parseWorkspaceActions`, or `WORKSPACE_ACTIONS_PROMPT`
2. **Lint:** `npm run lint` — confirm no new errors in changed files
3. **Tests:** `npx vitest run src/__tests__/services/parseWorkspaceActions.test.ts` — all 16 tests pass
4. **Import check:** `grep -r "parseWorkspaceActions\|WorkspaceAction\|WORKSPACE_ACTIONS_PROMPT" src/` — confirm no stale imports from `./AppServer.js` for these symbols (only `SessionManager.ts` and `AppServer.ts` should reference them, both from `./protocols/WorkspaceActions.js`)

## Files Changed

- `src/services/protocols/WorkspaceActions.ts` — **NEW** — extracted module
- `src/services/AppServer.ts` — removed definitions, added import from protocols
- `src/services/SessionManager.ts` — updated import path
- `src/__tests__/services/parseWorkspaceActions.test.ts` — updated import path
