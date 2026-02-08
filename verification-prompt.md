# Wire per-project agent timeout into AgentOrchestrator

## Goals
Read `agent_timeout_minutes` from the project config and use it as the agent timeout in `AgentOrchestrator.spawnAgent()`, replacing any hardcoded timeout with a per-project value (defaulting to 30 minutes).

## Acceptance Criteria

- [ ] `projects` table has an `agent_timeout_minutes` INTEGER column (nullable, added via migration)
- [ ] `AppProject` interface includes `agentTimeoutMinutes?: number`
- [ ] `getProject()` and `getProjects()` map `agent_timeout_minutes` to `agentTimeoutMinutes`
- [ ] `updateProject()` accepts and persists `agentTimeoutMinutes`
- [ ] `spawnAgent()` fetches project config via `db.getProject(options.projectId)`
- [ ] `spawnAgent()` uses `project.agentTimeoutMinutes` (falling back to 30 minutes) to set a timeout timer
- [ ] When timeout fires, agent is killed via SIGTERM -> 5s -> SIGKILL and status set to "failed"
- [ ] Timeout is cleared if process exits before it fires
- [ ] `tsc --noEmit` passes with no errors
- [ ] `eslint .` produces no new errors

## Verification Steps

1. Run `npm run type-check` — should pass cleanly
2. Run `npm run lint` — should have 0 errors (pre-existing warnings are OK)
3. Review `src/services/AppPersistence.ts`:
   - Migration at ~line 322: adds `agent_timeout_minutes` column
   - Interface at ~line 42: `agentTimeoutMinutes?: number`
   - `getProject()` at ~line 680: maps `r.agent_timeout_minutes`
   - `getProjects()` at ~line 662: maps `r.agent_timeout_minutes`
   - `updateProject()` interface at ~line 135: includes `agentTimeoutMinutes`
   - `updateProject()` SQL at ~line 364: includes `agent_timeout_minutes` in COALESCE
   - `updateProject()` impl at ~line 705: passes `updates.agentTimeoutMinutes`
4. Review `src/services/AgentOrchestrator.ts`:
   - `DEFAULT_AGENT_TIMEOUT_MINUTES = 30` constant at ~line 73
   - `db.getProject(options.projectId)` call after card fetch at ~line 258
   - `agentTimeoutMs` calculation at ~line 259
   - `setTimeout` with SIGTERM/SIGKILL at ~line 401
   - `child.on("close")` clears timeout at ~line 425
   - Log message includes timeout duration at ~line 428

## Files Changed

- `src/services/AppPersistence.ts` — schema migration, interface, getters, updater
- `src/services/AgentOrchestrator.ts` — per-project timeout in spawnAgent
- `verification-prompt.md` — this file
