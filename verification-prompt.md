# P2.1: Fix 12 any violations in AppPersistence

## Goals
Replace all `as any` / `as any[]` DB row casts in `AppPersistence.ts` with `Record<string, unknown>` and typed field access. Achieve 0 `@typescript-eslint/no-explicit-any` warnings in this file.

## Acceptance Criteria
- [ ] 0 `any` warnings when running `npx eslint src/services/AppPersistence.ts`
- [ ] No new type-check errors introduced (pre-existing errors in other files are unchanged)
- [ ] All 13 `as any` / `as any[]` casts replaced with `as Record<string, unknown>` variants
- [ ] `mapCardRow` parameter typed as `Record<string, unknown>` with explicit field casts
- [ ] Project row mappers use `as Record<string, unknown>[]` / `as Record<string, unknown> | undefined`
- [ ] ProjectDocument row mappers use same pattern
- [ ] Decision row mappers use same pattern
- [ ] Card-related single-row lookups (max position, max priority) use typed casts
- [ ] Runtime behavior unchanged (pure type-safety refactor)

## Verification Steps

1. **Lint check (primary exit criterion):**
   ```bash
   npx eslint src/services/AppPersistence.ts --rule '{"@typescript-eslint/no-explicit-any": "warn"}'
   ```
   Expected: no output (0 warnings)

2. **Type-check (no regressions):**
   ```bash
   npx tsc --noEmit 2>&1 | grep AppPersistence
   ```
   Expected: no errors referencing AppPersistence.ts directly (pre-existing AppServer.ts errors are unrelated)

3. **Grep for remaining `any` usage:**
   ```bash
   grep -n 'as any' src/services/AppPersistence.ts
   ```
   Expected: no matches

## Files Changed
- `src/services/AppPersistence.ts` — replaced 13 `any` casts across 5 domains:
  - `mapCardRow` helper (line ~689): parameter `any` -> `Record<string, unknown>`
  - `getProjects` / `getProject` (lines ~829, ~845): project row casts
  - `getProjectDocuments` / `getProjectDocument` (lines ~891, ~905): document row casts
  - `getCards` / `getCard` / `createCard` / `getNextCard` (lines ~946, ~952, ~961, ~1013): card row casts
  - `skipCardToBack` (lines ~1047-1048): max position/priority lookups
  - `getDecisions` / `getDecision` (lines ~1147, ~1163): decision row casts
