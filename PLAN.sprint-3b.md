# Sprint 3b — Heartbeat Hardening + Observability

**Goal**: The heartbeat never double-spawns, terminal agents get pruned, every agent event is traceable, and verification timeouts are surfaced — not swallowed.

**Branch**: `feat/openclaw-upgrades` (continues Sprint 3a)

---

## What Sprint 3a Already Fixed

| Bug | Fix | File | Lines |
|-----|-----|------|-------|
| Concurrent spawn race (TOCTOU) | `spawnMutex = Effect.makeSemaphore(1)` | AgentOrchestrator.ts | 92, 99 |
| Orphan worktrees on stop/shutdown | `git worktree remove --force` in stopAgent + shutdownAll | AgentOrchestrator.ts | 464-469, 511-516 |
| Orphan worktrees on crash | Heartbeat startup GC scans `.worktrees/`, skips `merge-*` | Heartbeat.ts | 608-630 |
| Push failure = false success | Verification/notification moved inside push try-block | AgentOrchestrator.ts | 290-330 |
| Premature status | Status stays "running" through verification; set at terminal points only | AgentOrchestrator.ts | 295, 311, 334, 364, 395, 413 |
| `agent.stopped` not broadcast | Added to WSServerMessage + emitted in stopAgent | shared/types, AO:471 |

---

## Sprint 3b Tasks (7 cards)

### Card 1: Heartbeat Tick Mutex (P0)

**Problem**: `tick()` is called from `node-cron` every 10 minutes AND from `submitTaskBrief()` via `options.immediate`. If a tick takes >10 min (e.g., slow Gate 0 disk check, slow DB query), the next cron fires while the first is still running. Both will call `getRunningAgents()` at roughly the same time, see the same state, and spawn duplicate agents for the same card.

**Fix**: Add a boolean `tickInProgress` guard at the top of `tick()`. If a tick is already running, the new invocation logs a skip and returns.

**File**: `src/services/Heartbeat.ts`

**Changes**:
1. After `const tasks: cron.ScheduledTask[] = []` (line 77), add:
   ```typescript
   let tickInProgress = false
   ```
2. At the top of `tick()` body (line 80-81), before `yield* Effect.log(...)`:
   ```typescript
   if (tickInProgress) {
     yield* Effect.log("Heartbeat tick skipped — previous tick still running")
     broadcast({ type: "heartbeat.skipped", timestamp: Date.now(), reason: "tick_in_progress" })
     return
   }
   tickInProgress = true
   ```
3. Wrap the rest of `tick()` body in a try/finally that always resets:
   ```typescript
   try {
     // ... existing tick body ...
   } finally {
     tickInProgress = false
   }
   ```
   Since we're in Effect.gen, use `Effect.ensuring`:
   ```typescript
   yield* Effect.ensuring(
     Effect.gen(function* () {
       // ... existing tick body from line 83 to 208 ...
     }),
     Effect.sync(() => { tickInProgress = false })
   )
   ```

**Test**: `src/__tests__/services/Heartbeat.test.ts` — new file
- `tick mutex prevents concurrent ticks`: Call `tick()` twice concurrently (no await on first). Assert second invocation returns immediately. Check that only 1 spawn happened.
- `tick mutex resets after error`: Make tick error (mock DB failure). Assert next tick runs normally.

---

### Card 2: Synthesize Mutex (P0)

**Problem**: Same issue as tick — `synthesize()` runs on cron at `:19` and `:39`. If a merge verification + push takes longer than 20 minutes, the next synthesize overlaps. This can cause the same card to be merged twice or conflict with itself.

**Fix**: Same pattern as Card 1 — `synthInProgress` boolean guard.

**File**: `src/services/Heartbeat.ts`

**Changes**:
1. After `tickInProgress`, add:
   ```typescript
   let synthInProgress = false
   ```
2. At top of `synthesize()` body (line 212-213), add same guard pattern.
3. Wrap body in `Effect.ensuring` to always reset.

**Test**: Same test file, similar pattern as Card 1.

---

### Card 3: Agents Map Pruning (P0)

**Problem**: The `agents` Map in AgentOrchestrator never deletes entries. Every completed, failed, blocked, or timed-out agent stays in memory forever. After weeks of operation, this is a slow memory leak. More importantly, `getRunningAgents()` iterates the entire Map on every call (including every heartbeat tick), which gets slower as the Map grows.

**Fix**: Add a `pruneTerminal()` function that runs after every agent task completes. Terminal agents (status: completed | failed | blocked) older than 1 hour get deleted from the Map.

**File**: `src/services/AgentOrchestrator.ts`

**Changes**:
1. After `const AGENT_TIMEOUT_MS = 30 * 60 * 1000` (line 90), add:
   ```typescript
   const PRUNE_AFTER_MS = 60 * 60 * 1000 // 1 hour
   ```
2. After the `cleanupWorktree` helper inside `spawnAgent` (line 218), add:
   ```typescript
   const pruneTerminal = () => {
     const now = Date.now()
     for (const [cardId, agent] of agents) {
       if (
         agent.status !== "running" &&
         now - agent.startedAt > PRUNE_AFTER_MS
       ) {
         agents.delete(cardId)
       }
     }
   }
   ```
3. Call `pruneTerminal()` at the end of the agent task — after `cleanupWorktree()` on line 391, and after `cleanupWorktree()` on line 407, and after `cleanupWorktree()` on line 424.
4. Also call `pruneTerminal()` at the end of `stopAgent` (after line 471) and in `shutdownAll` (after the for-loop, line 517).

**Test**: `src/__tests__/services/AgentOrchestrator.test.ts` — add to existing file
- `pruneTerminal removes agents older than PRUNE_AFTER_MS`: Spawn an agent, manually set status to "completed" and backdate `startedAt` by 2 hours. Spawn another (forces pruneTerminal). Assert first agent is gone from `getRunningAgents()`.
- `pruneTerminal keeps recent terminal agents`: Same but backdate only 5 minutes. Assert agent is still present.
- `pruneTerminal never removes running agents`: Spawn agent (stays running via HangingOllamaLayer). Backdate `startedAt` by 2 hours. Trigger prune. Assert agent still present.

---

### Card 4: Correlation IDs (spanId) (P1)

**Problem**: When an agent spawns, goes through Gate 0 → Ollama → Gate 1 → Smoke → Push, all events are correlated by `cardId`. But a card can be retried — blocked, moved to backlog, re-spawned. When that happens, the second run's events interleave with the first run's events in logs and audits. There's no way to distinguish "run 1" from "run 2" of the same card.

**Fix**: Generate a `spanId` (UUID) at spawn time. Include it in every broadcast, every audit log, and every agent log line for that run.

**File**: `src/services/AgentOrchestrator.ts`

**Changes**:
1. Add import at top:
   ```typescript
   import { randomUUID } from "crypto"
   ```
2. After `const branchName = ...` (line 167), add:
   ```typescript
   const spanId = randomUUID()
   ```
3. Add `spanId` to the `agentProcess` object (line 190):
   ```typescript
   const agentProcess: AgentProcess & { spanId: string } = {
     ...existing fields,
     spanId,
   }
   ```
4. Update `AgentProcess` interface to include `spanId: string`.
5. Update `addLog` to prefix with spanId (first 8 chars):
   ```typescript
   const addLog = (line: string) => {
     const tagged = `[${spanId.slice(0, 8)}] ${line}`
     agentProcess.logs.push(tagged)
     ...
   }
   ```
6. Include `spanId` in every `broadcast()` call and every `db.logAudit()` metadata object within `spawnAgent`.
7. Include `spanId` in the `getRunningAgents()` output (already spreads all fields).

**File**: `packages/shared/src/types/index.ts`
- No WSServerMessage changes needed — broadcasts are `Record<string, unknown>`.

**Test**: `src/__tests__/services/AgentOrchestrator.test.ts`
- `spanId is a valid UUID on spawned agent`: Spawn agent, assert `agentProcess.spanId` matches UUID regex.
- `two spawns of same card get different spanIds`: Spawn, stop, re-spawn same card. Assert spanIds differ.

---

### Card 5: VerificationProtocol Timeout Surfacing (P1)

**Problem**: `runCmd` in VerificationProtocol.ts catches *all* errors identically — a 120s timeout looks the same as a compilation error. The caller (AgentOrchestrator) just sees `passed: false` and a truncated output. There's no way to know if Gate 1 failed because the code is broken or because tsc hung for 2 minutes.

**Fix**: Distinguish timeout from error in `runCmd` and surface it in the result.

**File**: `src/services/protocols/VerificationProtocol.ts`

**Changes**:
1. Change `runCmd` return type:
   ```typescript
   type CmdResult = { ok: boolean; output: string; timedOut: boolean }
   ```
2. In the catch block (line 28-35), detect timeout:
   ```typescript
   catch (err: unknown) {
     const execErr = err as { stdout?: Buffer; stderr?: Buffer; killed?: boolean; signal?: string }
     const timedOut = execErr.killed === true || execErr.signal === "SIGTERM"
     const output = [
       execErr.stdout?.toString() ?? "",
       execErr.stderr?.toString() ?? "",
     ].join("\n").trim()
     return { ok: false, output: timedOut ? `TIMEOUT after ${timeoutMs}ms\n${output}` : output, timedOut }
   }
   ```
3. Add `timedOut` fields to `VerificationCheckResult`:
   ```typescript
   export interface VerificationCheckResult {
     passed: boolean
     tscOutput: string
     lintOutput: string
     testOutput: string
     tscTimedOut: boolean
     lintTimedOut: boolean
     testTimedOut: boolean
   }
   ```
4. Wire through in `runVerification`:
   ```typescript
   return {
     passed: tsc.ok && lint.ok && test.ok,
     tscOutput: tsc.output,
     lintOutput: lint.output,
     testOutput: test.output,
     tscTimedOut: tsc.timedOut,
     lintTimedOut: lint.timedOut,
     testTimedOut: test.timedOut,
   }
   ```

**File**: `src/services/AgentOrchestrator.ts`
- In the Gate 1 FAILED block (line 332-361), check for timeouts and include in the failure message:
  ```typescript
  const timeouts = [
    verification.tscTimedOut && "tsc",
    verification.lintTimedOut && "lint",
    verification.testTimedOut && "tests",
  ].filter(Boolean)
  if (timeouts.length > 0) {
    addLog(`[orchestrator] Gate 1 TIMEOUT: ${timeouts.join(", ")} exceeded 120s`)
  }
  ```

**Test**: `src/__tests__/protocols/VerificationProtocol.test.ts` — new file
- `runCmd returns timedOut=false on normal failure`: Mock a failing tsc. Assert `timedOut === false`.
- `runCmd returns timedOut=true when killed`: This is hard to unit test (needs real process timeout). Instead test that `VerificationCheckResult` includes the `timedOut` fields.
- `runVerification includes timedOut in result`: Call with a valid cwd, assert all three `timedOut` fields exist as booleans.

---

### Card 6: Smoke Test `.smoke-data` Cleanup (P2)

**Problem**: `SmokeTestProtocol.ts` creates ephemeral SQLite databases in `.smoke-data/` within the worktree. If the smoke test process crashes or the cleanup path is skipped, these accumulate. Since worktrees are cleaned up by the orchestrator, this is usually fine — BUT if the worktree cleanup also fails (edge case), temp DBs litter the disk.

**Fix**: Add explicit `.smoke-data` cleanup in the `cleanupWorktree` helper.

**File**: `src/services/AgentOrchestrator.ts`

**Changes**:
1. In the `cleanupWorktree` helper (line 212-218), before removing the worktree, also nuke `.smoke-data`:
   ```typescript
   const cleanupWorktree = () => {
     try {
       // Clean up smoke test temp data first
       const smokeDir = `${worktreeDir}/.smoke-data`
       if (fs.existsSync(smokeDir)) {
         execSync(`rm -rf ${smokeDir}`, { stdio: "pipe" })
       }
       execSync(`git worktree remove ${worktreeDir} --force`, { cwd: options.cwd, stdio: "pipe" })
     } catch {
       // Best effort — worktree may already be gone
     }
   }
   ```
2. Add `import * as fs from "fs"` at top of AgentOrchestrator.ts (if not already present).

**Test**: Existing `AgentOrchestrator.test.ts`
- `cleanupWorktree removes .smoke-data directory`: Create temp worktree, create `.smoke-data/` inside it with a dummy file, call stopAgent, assert directory is gone.

---

### Card 7: Heartbeat Test Infrastructure (P1)

**Problem**: Zero tests for Heartbeat.ts — the 665-line scheduler that drives the entire autonomous pipeline. Cards 1 and 2 require tests, and the service needs baseline coverage.

**Fix**: Create `src/__tests__/services/Heartbeat.test.ts` with stubs for all 6 dependencies.

**File**: `src/__tests__/services/Heartbeat.test.ts` — new file

**Test Cases**:
1. `tick processes active projects and spawns agents` — stub Kanban with 1 backlog card, assert spawnAgent called.
2. `tick respects per-project concurrency` — stub getRunningAgents with 1 running for project, assert no spawn.
3. `tick respects global concurrency limit` — stub getRunningAgents at max, assert no spawn.
4. `tick retries blocked cards after blockedRetryMinutes` — stub board with blocked card, backdate updatedAt. Assert skipToBack called.
5. `tick mutex prevents concurrent ticks` — Card 1 test.
6. `tick mutex resets after error` — Card 1 test.
7. `synthesize mutex prevents concurrent runs` — Card 2 test.
8. `synthesize mutex resets after error` — Card 2 test.
9. `submitTaskBrief creates card and triggers tick` — Assert card created with correct title, tick called.
10. `submitTaskBrief with immediate=false skips tick` — Assert tick NOT called.
11. `start() reconciles stuck cards on startup` — Stub board with running+blocked cards. Assert skipToBack called for each.

**Dependency Stubs Required**:
- `ConfigService`: workspace path, telegram userId, ollama model
- `Kanban`: getBoard, getNext, skipToBack, createCard, startWork, updateAgentStatus, saveContext, completeWork
- `AgentOrchestrator`: getRunningAgents, spawnAgent
- `AppPersistence`: getProjects, getCardsByVerificationStatus, logAudit, getCampaigns, getCampaignReports
- `Telegram`: sendMessage (noop)
- `ClaudeMem`: (noop — imported but unused)

**HEARTBEAT.md stub**: Create a minimal config file in temp dir:
```markdown
## Constraints
- maxConcurrentAgents: 2
- blockedRetryMinutes: 30

## Builder
- [x] processBacklog
- [x] retryBlocked

## Synthesizer
- [ ] mergeVerified

## Notifications
- [x] websocketEvents
- [ ] telegramSpawned
```

---

## Execution Order

```
Card 7 (Heartbeat test infra)     ← FIRST: sets up the test harness
  ↓
Card 1 (tick mutex)               ← Uses Card 7 test harness
Card 2 (synthesize mutex)         ← Uses Card 7 test harness
  ↓
Card 3 (agents Map pruning)       ← Independent, extends existing AO tests
Card 4 (correlation IDs / spanId) ← Independent, extends existing AO tests
  ↓
Card 5 (verification timeout)     ← Independent, new test file
Card 6 (smoke-data cleanup)       ← Smallest, extends existing AO tests
```

Cards 1+2 can be parallel. Cards 3+4 can be parallel. Cards 5+6 can be parallel.

---

## Files Changed (Summary)

| File | Cards | Nature |
|------|-------|--------|
| `src/services/Heartbeat.ts` | 1, 2 | tick/synth mutex guards |
| `src/services/AgentOrchestrator.ts` | 3, 4, 6 | pruneTerminal, spanId, smoke cleanup |
| `src/services/protocols/VerificationProtocol.ts` | 5 | timedOut field in runCmd + result |
| `packages/shared/src/types/index.ts` | 4 | spanId on AgentProcess (if exported) |
| `src/__tests__/services/Heartbeat.test.ts` | 7, 1, 2 | NEW — full test file |
| `src/__tests__/services/AgentOrchestrator.test.ts` | 3, 4, 6 | Extend existing tests |
| `src/__tests__/protocols/VerificationProtocol.test.ts` | 5 | NEW — verification tests |

**Estimated total**: ~400 lines of implementation, ~600 lines of tests.

---

## Acceptance Criteria

- [ ] `tick()` calls that overlap are skipped (logged + broadcast)
- [ ] `synthesize()` calls that overlap are skipped (logged + broadcast)
- [ ] Terminal agents are pruned from Map after 1 hour
- [ ] Every agent spawn gets a unique `spanId` visible in logs and audits
- [ ] Gate 1 timeout vs error is distinguishable in verification output
- [ ] `.smoke-data` is cleaned up before worktree removal
- [ ] Heartbeat test file exists with ≥11 tests
- [ ] Full gate check passes: type-check, lint, test, build
- [ ] Zero regressions on existing 200 tests
