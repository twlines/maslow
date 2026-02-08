# Verification: Add gh auth check before agent PR creation

## Goals

Prevent silent failures when `gh` CLI is not authenticated by checking `gh auth status` before attempting `git push` and `gh pr create` in the Agent Orchestrator's post-completion handler.

## Acceptance Criteria

- [ ] `gh auth status` is called before `git push` and `gh pr create` in the `child.on("close")` handler for `code === 0`
- [ ] The check uses `execSync("gh auth status", { stdio: "pipe" })` wrapped in try/catch
- [ ] If the check throws, the log message `[orchestrator] gh not authenticated — skipping PR creation` is emitted
- [ ] If the check throws, the push/PR block is skipped entirely (early return)
- [ ] If the check succeeds, the existing push/PR logic runs unchanged
- [ ] No new imports are required (`execSync` is already imported)
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint reports no new errors (`npm run lint`)

## Verification Steps

1. Read `src/services/AgentOrchestrator.ts` lines 342-365
2. Confirm the `gh auth status` check appears inside `.then(() => { ... })` before the `git push` try/catch block
3. Confirm the catch block logs the correct message and returns early
4. Run `npm run type-check` — should pass with no errors
5. Run `npm run lint` — should report no new errors (pre-existing warnings are acceptable)

## Files Changed

- `src/services/AgentOrchestrator.ts` — Added `gh auth status` guard before push/PR creation block (lines 343-349)
- `verification-prompt.md` — This file
