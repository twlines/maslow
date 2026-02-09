# P1.3: Fix no-useless-assignment

## Goals
Fix the `no-useless-assignment` ESLint error in the codebase so that `npm run lint` produces 0 useless-assignment warnings.

## Acceptance Criteria
- [ ] `npm run lint` produces 0 `no-useless-assignment` warnings
- [ ] No new lint errors introduced
- [ ] Type-check error count not increased (reduced from 11 to 5 by fixing duplicate declarations)

## Verification Steps
1. Run `npm run lint 2>&1 | grep "no-useless-assignment"` — should produce no output
2. Run `npm run lint 2>&1 | tail -3` — should show 0 errors
3. Run `npm run type-check 2>&1 | grep -c "error TS"` — should be 5 (4 pre-existing AppServer errors + 1 layer wiring issue)

## Files Changed
- `src/index.ts` — removed duplicate `Heartbeat` import (line 21), removed first unused `HeartbeatLayer` declaration (lines 45-49), removed duplicate `HeartbeatLayer` entry from `MainLayer` merge

## Root Cause
`src/index.ts` had:
1. A duplicate import of `{ Heartbeat, HeartbeatLive }` from `./services/Heartbeat.js` (lines 19 and 21)
2. Two `const HeartbeatLayer` declarations — the first (line 46) was a simple version that was immediately shadowed by a second (line 83) with the correct dependencies (AgentOrchestrator, Kanban, etc.)
3. `HeartbeatLayer` appeared twice in the `MainLayer` merge

The first `HeartbeatLayer` assignment was flagged by ESLint as useless since the value was never read before being overwritten.
