# P3.2: Extract ProjectRepository

## Goals
Move project CRUD operations (getProjects, getProject, createProject, updateProject) from AppPersistence into a dedicated ProjectRepository module using the factory function pattern.

## Acceptance Criteria

- [x] `ProjectRepository.ts` created with `createProjectRepository` factory function
- [x] `AppProject` interface and `ProjectUpdates` type defined in ProjectRepository
- [x] `AppPersistence` re-exports `AppProject` and `ProjectUpdates` for backward compatibility
- [x] `AppPersistence` delegates project methods to `ProjectRepository`
- [x] Project prepared statements moved from AppPersistence to ProjectRepository
- [x] Row mapping uses `Record<string, unknown>` (no `any`) in ProjectRepository
- [x] Internal `getProjectNameStmt` retained for `getUsageSummary` lookup
- [x] Type-check passes (no new errors introduced)
- [x] All existing tests pass (68 passed, 8 skipped)
- [x] Lint passes (no new warnings/errors introduced)

## Verification Steps

1. `npm run type-check` — should show only pre-existing errors (index.ts duplicates, AppServer missing members)
2. `npm run lint` — should show only pre-existing warnings (no-explicit-any, no-unused-vars in other files)
3. `npm run test` — all 68 tests pass, 8 skipped
4. Verify `AppProject` type is still importable from `./AppPersistence.js` by checking callers compile
5. Verify no caller changes were needed (all callers use `AppPersistence` service, delegation is transparent)

## Files Changed

- `src/services/ProjectRepository.ts` (NEW) — factory function with AppProject interface, prepared statements, row mapping
- `src/services/AppPersistence.ts` (MODIFIED) — imports/delegates to ProjectRepository, re-exports types, removed inline project code
