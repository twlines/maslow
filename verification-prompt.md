# P3.11: Strip PR creation from agents, add orchestrator PR cycle

## Goals

- Remove PR creation logic from AgentOrchestrator.spawnAgent
- Agents commit to feature branches only, no push, no PR
- Add twice-daily orchestrator PR schedule to Heartbeat (configurable times)
- Orchestrator reviews completed branches, consolidates related changes, creates PRs

## Acceptance Criteria

- [ ] AgentOrchestrator.spawnAgent no longer pushes branches or creates PRs
- [ ] Agent completion handler still saves context with branch name, marks card done, sends Telegram notification, and cleans up worktree
- [ ] Heartbeat service has a new `prCycle()` method
- [ ] PR cycle runs on a configurable cron schedule (default: 10am and 4pm daily)
- [ ] PR cycle checks `gh auth status` before attempting operations
- [ ] PR cycle scans completed cards for branch names in context snapshots
- [ ] PR cycle checks if branch exists locally and if PR already exists before creating
- [ ] PR cycle pushes branch and creates PR with retry logic (3 attempts, 5s delay)
- [ ] PR cycle sends Telegram summary of created PRs
- [ ] PR cycle broadcasts `heartbeat.prCycle` WebSocket event
- [ ] PR_SCHEDULE env var allows configuring the cron expression
- [ ] No new type-check errors introduced (pre-existing errors in index.ts and AppServer.ts are unchanged)
- [ ] No new lint errors introduced

## Verification Steps

1. Read `src/services/AgentOrchestrator.ts` and verify:
   - The `.then()` block after agent completion (around line 508) no longer contains `gh auth status`, `git push`, or `gh pr create` calls
   - The `.then()` block only logs and calls `cleanupWorktree()`
   - The file header comment reflects the new behavior

2. Read `src/services/Heartbeat.ts` and verify:
   - `HeartbeatService` interface includes `prCycle()` method
   - `execSync` is imported from `child_process`
   - `DEFAULT_PR_SCHEDULE`, `PR_MAX_RETRIES`, `PR_RETRY_DELAY_MS` constants are defined
   - `extractBranch()` helper correctly parses branch names from context snapshots
   - `prCycle()` implementation:
     - Checks `gh auth status` first
     - Iterates completed cards across all active projects
     - Validates branch exists locally via `git rev-parse`
     - Checks for existing PRs via `gh pr list --head`
     - Pushes and creates PR with retry loop
     - Sends Telegram summary and broadcasts event
   - `start()` method schedules the PR cycle cron task using `PR_SCHEDULE` env var
   - Return object includes `prCycle`

3. Run `npm run type-check` — verify no new errors beyond pre-existing ones in `src/index.ts` and `src/services/AppServer.ts`

4. Run `npm run lint --quiet` — verify no new errors beyond pre-existing `no-useless-assignment` in `src/index.ts:46`

## Files Changed

- `src/services/AgentOrchestrator.ts` — Removed PR creation block (push + gh pr create + retry loop), updated file header
- `src/services/Heartbeat.ts` — Added `prCycle()` method, PR cycle cron schedule, `extractBranch()` helper, configurable schedule
