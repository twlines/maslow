# Verification: Add agent_timeout_minutes and max_concurrent_agents to projects table

## Card Title
Add agent_timeout_minutes and max_concurrent_agents to projects table

## Goals
Add two new columns to the `projects` table in AppPersistence to support per-project agent configuration: timeout duration and concurrency limits.

## Acceptance Criteria

- [ ] Migration adds `agent_timeout_minutes INTEGER DEFAULT 30` to `projects` table
- [ ] Migration adds `max_concurrent_agents INTEGER DEFAULT 1` to `projects` table
- [ ] Migration uses `pragma table_info` check pattern (consistent with existing migrations)
- [ ] `AppProject` interface includes `agentTimeoutMinutes?: number` and `maxConcurrentAgents?: number`
- [ ] `getProjects()` returns the new fields
- [ ] `getProject(id)` returns the new fields
- [ ] `updateProject()` accepts and persists the new fields
- [ ] Shared `Project` type in `packages/shared/src/types/index.ts` matches `AppProject`
- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] ESLint passes without new errors (`npm run lint`)

## Verification Steps

1. **Type check**: Run `npm run type-check` -- should pass with no errors
2. **Lint**: Run `npm run lint` -- should have 0 errors (pre-existing warnings are OK)
3. **Migration idempotency**: The migration uses `pragma table_info` to check column existence before altering, so running the app multiple times won't fail
4. **Backwards compatibility**: Both new fields are optional (`?` in TS, `DEFAULT` in SQL), so existing data and consumers are unaffected
5. **Data round-trip**: Creating a project uses SQL defaults (30 / 1), `getProject` maps them. Updating via `updateProject` with `{ agentTimeoutMinutes: 60 }` should persist and return correctly.

## Files Changed

- `src/services/AppPersistence.ts` -- migration, interface, prepared statement, row mappings, service implementation
- `packages/shared/src/types/index.ts` -- shared `Project` interface
