# Verification: Write workspace action block parser

## Card Title
Write workspace action block parser

## Goals
Create an exported, unit-testable `parseWorkspaceActions(text: string): WorkspaceAction[]` function in `src/services/AppServer.ts` that parses `:::action {json} :::` blocks from Claude text output.

## Acceptance Criteria
- [x] `WorkspaceAction` interface is exported from `AppServer.ts`
- [x] `parseWorkspaceActions` function is exported from `AppServer.ts`
- [x] Function parses `:::action\n{json}\n:::` blocks using regex
- [x] JSON.parse is applied to each match
- [x] The `type` field is validated against the union (`create_card | move_card | log_decision | add_assumption | update_state`)
- [x] Malformed JSON blocks are silently skipped
- [x] Invalid `type` values are silently skipped
- [x] Missing `type` field is silently skipped
- [x] Non-object JSON values (null, arrays, primitives) are silently skipped
- [x] Function is pure — no side effects
- [x] Existing internal `parseActions` now delegates to the new function
- [x] All unit tests pass (16 tests)
- [x] TypeScript compiles cleanly (`tsc --noEmit`)
- [x] ESLint reports no new errors

## Verification Steps
1. Run `npx tsc --noEmit` — should compile with no errors
2. Run `npx vitest run src/__tests__/services/parseWorkspaceActions.test.ts` — all 16 tests should pass
3. Run `npx eslint src/services/AppServer.ts` — no new errors (pre-existing warnings only)
4. Verify the export: `grep "export function parseWorkspaceActions" src/services/AppServer.ts`
5. Verify interface export: `grep "export interface WorkspaceAction" src/services/AppServer.ts`
6. Verify internal wiring: `grep "const parseActions = parseWorkspaceActions" src/services/AppServer.ts`

## Files Changed
- `src/services/AppServer.ts` — exported `WorkspaceAction` interface, added `parseWorkspaceActions` function, wired internal `parseActions` alias
- `src/__tests__/services/parseWorkspaceActions.test.ts` — 16 unit tests covering happy path, edge cases, and validation
- `verification-prompt.md` — this file
