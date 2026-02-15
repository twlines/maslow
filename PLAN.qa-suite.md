# QA Suite & Verification Flows — Real Environment Validation

## The Problem

Both Maslow and Aiden have the same gap: **tests prove code compiles and mocks behave, but nothing proves the software works in a real environment.**

- Maslow's Gate 1: tsc + lint + vitest → "types align" ≠ "feature works"
- Aiden's 701 tests: Jest with mocked Firebase → "logic correct in isolation" ≠ "pipeline works end-to-end"

What's missing is the layer between "tests pass" and "users see it" — **ephemeral environments + behavioral validation + contract enforcement**.

---

## Architecture: Three Verification Layers

```
Layer 1: Static (what we have)
  tsc + lint + unit tests + coverage gates
  ↓
Layer 2: Behavioral (what we need)
  Ephemeral environment → contract tests → smoke tests → acceptance tests
  ↓
Layer 3: Canary (production safety net)
  Staged rollout → health monitoring → auto-rollback
```

---

## MASLOW — What To Build

### M1. Ephemeral Server from Agent Branches

**What**: After Gate 1 passes, stand up a real Maslow server instance from the agent's worktree branch. Run behavioral tests against it. Tear it down.

**How**:
- Agent branch passes Gate 1 (tsc + lint + test) ✓
- New step: `npm run build` in worktree → start server on a random port
- Wait for `/api/health` to return 200
- Run behavioral smoke tests against that port
- Kill server, report pass/fail
- Only push branch if smoke tests pass

**File**: `src/services/protocols/SmokeTestProtocol.ts`

**Tests** (hit real HTTP endpoints, real SQLite):
- `POST /api/projects` → 201, body has `id` and `name`
- `GET /api/projects` → 200, array includes the project we just created
- `POST /api/projects/:id/cards` → 201, card appears in project
- `PUT /api/projects/:id/cards/:cardId` → card column updated
- `GET /api/projects/:id/cards` → cards returned in priority order
- `POST /api/messages` via WebSocket → message persisted and echoed
- `GET /api/health` → includes agent count, uptime, DB status
- `GET /api/search?q=term` → FTS5 returns relevant results

**Integration point**: AgentOrchestrator calls `SmokeTestProtocol.run(port)` after Gate 1, before push.

### M2. API Contract Tests

**What**: Define the expected request/response shapes for every endpoint. Test both sides — server returns the shape, client expects the shape.

**How**:
- Shared contract definitions in `packages/shared/src/contracts/`
- Each contract: endpoint path, method, request body schema (Zod), response body schema (Zod)
- Server test: hit endpoint, validate response against schema
- Client test: mock server returning schema-valid response, verify client parses it

**Contracts to define**:
- Projects CRUD (5 endpoints)
- Cards CRUD + lifecycle (8 endpoints)
- Messages (3 endpoints)
- Conversations (2 endpoints)
- Agents (3 endpoints)
- Voice (3 endpoints)
- Steering (5 endpoints)
- Search, Audit, Backup, Export (4 endpoints)

### M3. Regression Snapshots

**What**: Before the agent runs, capture the current API responses. After the agent runs, compare. Any unintended change = flag.

**How**:
- Pre-agent: hit all endpoints with fixture data, save response snapshots
- Post-agent: hit same endpoints, diff against snapshots
- Expected changes (matching the card scope): allowed
- Unexpected changes: BLOCK — agent modified behavior outside its scope

**File**: `src/services/protocols/RegressionProtocol.ts`

### M4. Gate 0 — Pre-Execution Validation

**What**: Before spawning an agent, validate the card is ready for autonomous work.

**Checks**:
- Card has non-empty title
- Card has description OR context_snapshot (agent needs instructions)
- No other agent is already working on this card
- Worktree can be created (disk space check, git state clean)
- Required skills exist for this card type (SkillLoader.selectForTask returns > 0)

### M5. Gate 1.5 — Automated Diff Review

**What**: After Gate 1 passes, before pushing, run the `/diff-review` logic programmatically.

**Checks**:
- No `any` types introduced in the diff
- All new imports use `.js` extensions
- No `console.log` left in changed files
- Diff is under 400 lines
- No changes to config files (tsconfig, eslint, package.json)
- Boundary rules respected (no `apps/` importing `src/`)

**File**: `src/services/protocols/DiffReviewProtocol.ts`

### M6. Gate 3 — Post-Merge Smoke Test

**What**: After Gate 2 merges into integration branch, verify the merged state can actually run.

**How**: Same as M1 but on the integration branch. Start server, hit `/api/health`, run contract tests. If fail → revert merge commit automatically.

---

## AIDEN — What To Build

### A1. Firebase Emulator Integration Test Suite

**What**: Stand up Firebase Emulator Suite (Firestore + Storage + Functions) and run the full pipeline against it. No mocks.

**How**:
- `firebase emulators:exec` runs the test suite against local emulators
- Emulator ports already configured (Firestore: 58080, Storage: 59199)
- Tests use real Firestore writes and reads, real Cloud Storage uploads

**Tests**:
- Upload a recording → trigger pipeline → verify Firestore `practice_analyses` doc created
- Create action item via API → verify it appears in Firestore with correct practice scoping
- Create action item in Practice A → verify Practice B user CANNOT read it (isolation)
- Run intelligence extraction on fixture transcript → verify output matches expected schema
- Test checkpoint-resume: interrupt pipeline mid-execution → verify it resumes from checkpoint

**File**: `apps/mobile/backend/functions/__tests__/e2e/emulator-pipeline.test.ts`

### A2. API Contract Tests (Mobile ↔ Backend)

**What**: The mobile app calls 20+ backend endpoints. Define contracts, test both sides.

**How**:
- Shared contract definitions in `packages/shared-types/src/contracts/`
- Backend test: hit real endpoint (via emulator), validate response shape
- Mobile test: given a contract-valid response, verify the app parses and renders it

**Critical contracts**:
- `POST /api/processRecording` — upload flow
- `GET /api/actionItems` — action item list
- `POST /api/actionItems` — create action item
- `PUT /api/actionItems/:id` — update action item
- `GET /api/teamMembers` — team roster
- `POST /api/recognitions` — create recognition
- `GET /api/clinicalNotes` — clinical notes list
- `POST /api/feedback` — feedback submission

### A3. Intelligence Pipeline Smoke Tests

**What**: Test the full intelligence pipeline with real LLM calls against fixture transcripts. Validate output schema AND semantic quality.

**How**:
- Fixture transcripts: 3-5 real (anonymized) recordings per pipeline type
- Run each pipeline (Triad, PDM, PatientConv, Huddle) against fixtures
- Validate: output passes Zod schema, all required fields populated, confidence scores in range
- Semantic checks: output mentions key terms from transcript, action items reference real discussion points

**This extends the existing Ralph Wiggum framework** — same YAML schema, broader scope.

**Files**:
- `packages/intelligence/tests/smoke/triad-smoke.test.ts`
- `packages/intelligence/tests/smoke/pdm-smoke.test.ts`
- `packages/intelligence/tests/smoke/patient-conv-smoke.test.ts`
- `packages/intelligence/tests/smoke/huddle-smoke.test.ts`

### A4. Dashboard E2E Tests (Playwright)

**What**: The dashboard has 11 test files and zero E2E. Practice managers use it daily. Add Playwright.

**Tests**:
- Login flow (Google OAuth mock → session established)
- Practice list → click practice → see pulse card with real data
- Navigate to recordings → see recording list
- Navigate to action items → see items scoped to practice
- Navigate to team → see team members with roles
- Mobile health dashboard → verify build status rendering

**File**: `apps/dashboard/e2e/`

### A5. Staging Firebase Project

**What**: A separate Firebase project (`team-aiden-staging`) that mirrors prod structure but with test data.

**Purpose**:
- Preview deploys (Vercel) point to staging Firestore, not prod
- Mobile preview builds connect to staging backend
- Intelligence pipeline tests run against staging
- PHI never touches staging — only anonymized fixture data

**Infrastructure**:
- `infra/terraform/staging/` — mirrors prod IAM but for staging project
- `firebase.staging.json` — emulator config for staging
- CI workflow: deploy to staging on PR merge to `develop`, deploy to prod on merge to `main`

### A6. Post-Deploy Health Checks

**What**: After every deploy (Vercel, Firebase Functions, Cloud Run), hit the live endpoints and verify they respond correctly.

**How**:
- GitHub Actions workflow: `post-deploy-health.yml`
- Triggered after successful deploy
- Hits: `/api/health`, `/api/actionItems` (with test auth), MCP server health
- Verifies: 200 status, response time < 2s, expected response shape
- On failure: Slack/Telegram alert + automatic rollback (Vercel: promote previous, Firebase: rollback functions)

---

## Build Order

### Phase 1: Maslow Ephemeral Server (M1 + M4)
- Highest leverage — every agent branch gets validated in a real runtime
- Gate 0 prevents wasting compute on bad cards
- Estimated: 1 session

### Phase 2: Maslow Contract Tests (M2 + M5)
- Lock down API shapes so agent changes can't silently break the client
- Automated diff review catches style/safety issues
- Estimated: 1 session

### Phase 3: Aiden Emulator Tests (A1 + A2)
- Firebase Emulator Suite is already configured — just needs test code
- Contract tests between mobile and backend prevent silent breakage
- Estimated: 1-2 sessions

### Phase 4: Intelligence Smoke Tests (A3)
- Extends Ralph Wiggum framework to full pipeline validation
- Real LLM calls against fixture transcripts (costs ~$0.50/run)
- Estimated: 1 session

### Phase 5: Dashboard E2E + Staging (A4 + A5)
- Playwright for the dashboard
- Staging Firebase project for safe preview environments
- Estimated: 2 sessions

### Phase 6: Post-Deploy Health + Canary (A6 + M3 + M6)
- Production safety net
- Auto-rollback on health check failure
- Regression snapshots for Maslow agent output
- Estimated: 1 session

---

## What This Gives You

**Before** (current):
```
Code written → types check → mocks pass → deploy → pray
```

**After**:
```
Code written → types check → mocks pass → ephemeral server starts →
  API contracts verified → smoke tests pass → behavioral tests pass →
  diff reviewed → deploy to staging → post-deploy health check →
  canary rollout → full deploy
```

Every layer catches a different class of bug:
- **Static (Layer 1)**: Type errors, lint violations, logic errors in isolation
- **Behavioral (Layer 2)**: Integration failures, contract mismatches, runtime crashes, scope creep
- **Canary (Layer 3)**: Performance regressions, infrastructure issues, data migration problems

The machine validates its own output before it reaches anyone.

---
---

# Deep Research Synthesis: QA Gap Analysis

**Date**: 2026-02-14
**Method**: 4-pass deep audit (test coverage, API boundary validation, agent pipeline gaps, CI/CD infrastructure)
**Mapped to**: QA Architecture Brief — 5-Layer Model

---

## Executive Summary

Maslow has a solid foundation — 86 passing tests, a working CI pipeline, Zod schemas ready for use, and Gate 0 + Smoke Test protocols built. But the audit reveals **severe gaps in the middle layers**: API boundary validation is absent, the agent pipeline has 8 critical concurrency/reliability issues, and the Zod schemas we built aren't wired into any endpoints.

**Key numbers**:
- **3/22 services** have test coverage (14%)
- **0/47 API endpoints** have integration tests
- **8 critical** agent pipeline issues (data loss, cascading failures)
- **20+ endpoints** crash on malformed JSON (500 instead of 400)
- **1 path traversal vulnerability** in `/api/agents/spawn`

---

## Findings by QA Architecture Layer

### Layer 1: Spec Contracts (Source of Truth)

**Status**: Partially built, not integrated.

Zod schemas exist in `packages/shared/src/schemas/index.ts` for all core models — `ProjectSchema`, `KanbanCardSchema`, `MessageSchema`, `HealthStatusSchema`, request body schemas, etc. But they are **never imported or used** in `src/services/AppServer.ts`.

| What Exists | What's Missing |
|------------|---------------|
| 28 Zod schemas covering all models + request bodies | Schema validation at API boundaries (0 endpoints use schemas) |
| `ApiResponseSchema<T>` wrapper for typed responses | WebSocket message schema (voice audio, chat, subscribe) |
| Request body schemas (CreateProject, CreateCard, etc.) | Response envelope enforcement (responses are ad-hoc `{ ok, data }`) |

**P0 Action**: Wire Zod schemas into AppServer POST/PUT handlers. Every `JSON.parse(await readBody(req))` should become `Schema.safeParse(...)` with 400 on validation failure.

### Layer 2: Dev-Time Verification

**Status**: Strong foundation, significant blind spots.

**What works**:
- 86 tests across 6 files, all passing
- Gate 0 Protocol: 10 tests covering all validation paths
- Persistence: 11 tests with real SQLite
- parseWorkspaceActions: 16 tests with comprehensive error handling
- CI: lint + type-check + test + build on every PR

**Critical blind spots**:
- 19/22 services have **zero** test coverage
- No AppServer endpoint tests (47 endpoints, all untested)
- No schema validation test suite
- No WebSocket tests
- No voice pipeline tests
- No agent orchestration tests

**Coverage by service category**:

| Category | Services | Tested | Coverage |
|----------|----------|--------|----------|
| Core Infrastructure | Config, Persistence, AppPersistence | 1/3 | 33% |
| API Layer | AppServer (47 endpoints) | 0/1 | 0% (parser utility only) |
| Agent Pipeline | AgentOrchestrator, OllamaAgent, SkillLoader | 0/3 | 0% |
| Protocols | Gate0, SmokeTest, Verification, AgentProtocols | 1/4 | 25% |
| Business Logic | Kanban, SteeringEngine, ThinkingPartner | 0/3 | 0% |
| External | ClaudeSession, Telegram, Voice, ClaudeMem | 0/4 | 0% |
| Support | Heartbeat, Notification, Proactive, SoulLoader | 0/4 | 0% |

### Layer 3: CI / Deploy Gates

**Status**: CI exists and matches CLAUDE.md requirements. Deploy gates missing.

**CI workflow** (`.github/workflows/ci.yml`):
- Triggers on PR to main
- Runs: build shared → lint → type-check → test → build
- All 4 required steps present and in correct order

**What's missing**:
- No deploy gate (no automated deployment at all — manual launchd on Mac Mini)
- No post-deploy health check
- No integration test job in CI (existing integration tests not wired in)
- No spec validation job
- Pre-commit hook exists in `scripts/hooks/pre-commit` but **is not active** (`core.hooksPath` not configured)
- Branch protection rules documented in CONTRIBUTING.md but not verified in GitHub Settings
- No CODEOWNERS file

### Layer 4: Production Validation

**Status**: Not implemented.

- No post-deploy smoke tests
- No SLO monitoring
- No structured logging (ad-hoc strings via `onLog()`)
- No correlation IDs across agent pipeline stages
- No metrics collection (no histograms, no failure rate tracking)
- No alerting (no Slack/Telegram notifications on failure)

### Layer 5: Bug → Regression Pipeline

**Status**: Template exists, pipeline doesn't.

- Bug report issue template created (`.github/ISSUE_TEMPLATE/bug_report.yml`) with structured fields
- No automated intake → regression spec workflow
- No historical bugs formalized as regression specs
- No regression spec runner

---

## Critical Security Findings

### High Severity

1. **Path Traversal via `cwd` Parameter** (`AppServer.ts` line ~864)
   - `POST /api/agents/spawn` accepts user-controlled `cwd` field
   - No validation that `cwd` is within workspace directory
   - Agent could access/modify files outside intended scope
   - **Fix**: Validate `path.resolve(cwd).startsWith(path.resolve(workspacePath))`

2. **Malformed JSON Crashes** (~20 POST/PUT endpoints)
   - `JSON.parse(await readBody(req))` without try/catch
   - Returns 500 Internal Server Error instead of 400 Bad Request
   - Only 1 of ~20 endpoints has proper JSON error handling
   - **Fix**: Safe parse wrapper → 400 on invalid JSON

### Medium Severity

3. **No Query Parameter Bounds**
   - `limit`, `offset`, `days` accept negative, NaN, Infinity
   - `?limit=999999999` → potential memory exhaustion
   - **Fix**: `validateLimit(param, default, max)` helper

4. **WebSocket Audio Buffer No Size Limit**
   - `Buffer.from(msg.audio, "base64")` — no max size
   - 100MB+ payload → memory exhaustion (DoS)
   - **Fix**: Max 5MB for audio, 10KB for text

5. **No Rate Limiting**
   - `/api/auth/token` vulnerable to brute force
   - Voice endpoints vulnerable to resource exhaustion
   - **Fix**: Per-IP rate limiter for auth (5/min), per-user for resources (100/min)

### Safe

- SQL injection: Protected (prepared statements throughout)
- Response format: Consistent `{ ok, data }` / `{ ok: false, error }`
- Auth: Token-based with JWT, health endpoint intentionally unauthenticated

---

## Agent Pipeline Critical Issues

### Tier 1: Data Loss / Cascading Failure Risk

1. **Concurrent Spawn Race** — `agents` Map checks are not atomic. Two simultaneous `spawnAgent` calls can both pass guards, second overwrites first's state in Map. First fiber runs unsupervised.
   - File: `AgentOrchestrator.ts:99-116`
   - Fix: Effect.Semaphore or sequential queue

2. **Worktree Orphans** — If fiber creation fails after worktree creation, `cleanupWorktree()` never runs. No garbage collector scans for orphans.
   - File: `AgentOrchestrator.ts:406, 209-215`
   - Fix: Periodic GC in Heartbeat

3. **Heartbeat Tick Overlap** — Cron at :10/:20/:30/:40/:50. If tick takes >10 min, next tick fires before previous completes. Both can spawn agents on same card.
   - File: `Heartbeat.ts:608-616`
   - Fix: Effect.Semaphore around `tick()`

4. **Push Failure Broadcast** — Agent marked "completed" and broadcast even if `git push` fails. User sees success, but branch is local-only.
   - File: `AgentOrchestrator.ts:301-307`
   - Fix: Don't broadcast success until push confirmed

### Tier 2: Silent Failures

5. **Verification Timeout vs Error** — Gate 1 can't distinguish "tsc timed out (server overloaded)" from "tsc found errors (code broken)". Both return same error.
   - File: `VerificationProtocol.ts:19-35`

6. **Card State Divergence** — `agent_status=completed` + `verification_status=branch_failed` is a legal but unrecoverable state. Card is never retried or cleaned up.

7. **No Correlation IDs** — Card ID logged per audit entry but no trace ID follows request through Gate 0 → Ollama → Gate 1 → Smoke → Push. Debugging multi-stage failures requires manual log correlation.

---

## Prioritized Implementation Roadmap

### Sprint 1: Harden the Boundary -- COMPLETE (2026-02-14)

**Goal**: Every API endpoint validates input and handles errors correctly.

| Task | Status | Notes |
|------|--------|-------|
| Wire Zod schemas into all POST/PUT endpoints | DONE | 15 endpoints validated via 10 new Zod request schemas |
| Fix path traversal in `/api/agents/spawn` | DONE | `cwd` now always `config.workspace.path`, user input ignored |
| Add `safeParseJson` wrapper for all endpoints | DONE | All 18 `JSON.parse` calls wrapped — 400 on bad JSON |
| Add query parameter bounds validation | DONE | `clampInt()` on all 10 `parseInt` sites (NaN/negative/huge clamped) |
| Add WebSocket message schema validation | DONE | 5MB max message, chat content/voice audio validated |
| Add rate limiting to auth + voice endpoints | DEFERRED | P2, moved to Sprint 4 |

### Sprint 2: Test the Untested (5-7 days)

**Goal**: Critical path services have test coverage. AppServer endpoints validated.

| Task | Priority | Effort | Impact |
|------|----------|--------|--------|
| AppServer endpoint integration tests (top 15 endpoints) | P0 | 3 days | 0% → ~30% endpoint coverage |
| AppPersistence unit tests (CRUD for projects, cards, docs) | P0 | 1 day | Data layer validated |
| Kanban service tests (card lifecycle, state transitions) | P1 | 1 day | Business logic validated |
| Schema round-trip tests (Zod schemas validate real data) | P1 | 3 hours | Contract integrity |
| WebSocket connection + message tests | P1 | 3 hours | Real-time path validated |
| AgentOrchestrator spawn/stop tests | P2 | 1 day | Pipeline entry point validated |

### Sprint 3: Fix the Pipeline (3-5 days)

**Goal**: Agent pipeline is reliable under concurrency.

| Task | Priority | Effort | Impact |
|------|----------|--------|--------|
| Atomic spawn check (Effect.Semaphore) | P0 | 3 hours | Prevents lost agents |
| Worktree garbage collector in Heartbeat | P0 | 2 hours | Prevents disk exhaustion |
| Heartbeat tick mutex | P0 | 2 hours | Prevents duplicate spawns |
| Push failure → don't broadcast success | P1 | 1 hour | Prevents false success |
| Add correlation IDs to spawn pipeline | P1 | 3 hours | Enables debugging |
| Distinguish timeout vs error in Gate 1 | P1 | 2 hours | Better error messages |
| Smoke test `.smoke-data` cleanup | P2 | 30 min | Prevents temp DB accumulation |

### Sprint 4: Observability + Deploy Gates (ongoing)

**Goal**: The system tells you when it's lying.

| Task | Priority | Effort | Impact |
|------|----------|--------|--------|
| Structured logging with pino | P1 | 1 day | Machine-parseable logs |
| Activate pre-commit hook (`core.hooksPath`) | P1 | 5 min | Enforces CLI spawn rules |
| Add integration tests to CI workflow | P1 | 1 hour | Integration tests run on every PR |
| Agent metrics collection (duration, failures, tokens) | P2 | 1 day | Trend detection |
| Post-deploy smoke test script | P2 | 3 hours | Validates live deployments |
| Verify GitHub branch protection rules | P2 | 15 min | Enforce review + CI requirements |

---

## Compliance Matrix: QA Architecture Brief vs Current State

| Brief Recommendation | Status | Gap |
|---------------------|--------|-----|
| Layer 1: Spec Contracts (YAML/JSON) | Partial | Zod schemas built, not integrated at boundaries |
| Layer 2: Dev-Time Verification | Strong | 86 tests passing, but 86% of services untested |
| Layer 3: CI/Deploy Gates | Partial | CI exists, no deploy gates, no integration test job |
| Layer 4: Production Validation | Missing | No post-deploy smoke, no SLOs, no structured logging |
| Layer 5: Bug→Regression Pipeline | Minimal | Issue template exists, no automated pipeline |
| `qa:smoke` CLI | Missing | SmokeTestProtocol exists but no CLI wrapper |
| `qa:spec` CLI | Missing | No spec runner |
| `qa:regression` CLI | Missing | No regression specs |
| Structured bug intake | Partial | Issue template has structured fields, no automation |
| SLO monitoring | Missing | No health monitoring, no alerting |

---

## What This Means

**Before this audit**: "Tests pass" = confidence.
**After this audit**: "Tests pass" = 14% of services validated, 0% of API endpoints tested, 8 critical pipeline bugs waiting.

The Zod schemas are the bridge. They exist. They're correct. They just need to be plugged in at every `JSON.parse` call in AppServer. That single change eliminates an entire class of bugs (malformed input crashes) and creates the foundation for contract testing.

The agent pipeline works on the happy path. It fails silently on every other path. The 5 most impactful fixes (atomic spawn, worktree GC, heartbeat mutex, push verification, correlation IDs) would take ~2 days and eliminate the top tier of reliability risks.

The system doesn't tell you when it's lying. That's the gap. Structured logging + metrics + correlation IDs are what turn "something's wrong" into "this is what's wrong, when it started, and what triggered it."
