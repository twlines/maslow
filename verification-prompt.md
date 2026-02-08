# Verification: Add retry logic to agent git push and PR creation

## Card Goals
Wrap the git push + `gh pr create` block in AgentOrchestrator.ts in a retry loop so transient network or GitHub API failures don't silently lose the PR creation step.

## Acceptance Criteria
- [ ] The `.then()` callback is now `async`
- [ ] A `for` loop runs up to 3 attempts
- [ ] On each failure, the attempt number and error are logged via `addLog`
- [ ] Between failures, a 5-second delay (`await delay(5000)`) is applied
- [ ] On final failure (attempt 3), a log line states all attempts failed and the branch is preserved
- [ ] On success, `break` exits the loop immediately
- [ ] If all 3 attempts fail, no exception is thrown (the `.catch()` handler is still in place but won't fire from retry logic)
- [ ] `npm run type-check` passes with no errors
- [ ] `npm run lint` produces no new errors or warnings

## Verification Steps
1. Read `src/services/AgentOrchestrator.ts` lines 342-369
2. Confirm the `.then(async () => {` signature
3. Confirm `MAX_RETRIES = 3` and `RETRY_DELAY_MS = 5000`
4. Confirm the `delay` helper uses `new Promise((resolve) => setTimeout(resolve, ms))`
5. Confirm the `for` loop iterates `attempt = 1` to `MAX_RETRIES`
6. Confirm `break` after successful `addLog` on line 359
7. Confirm the catch block logs attempt number and conditionally awaits delay or logs final failure
8. Run `npm run type-check` — should pass
9. Run `npm run lint` — no new warnings in AgentOrchestrator.ts

## Files Changed
- `src/services/AgentOrchestrator.ts` — retry loop around git push + gh pr create (lines 342-369)
- `verification-prompt.md` — this file
