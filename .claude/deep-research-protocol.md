# Deep Research Protocol

Multi-pass deep research loop before any implementation plan is finalized. Required for any task large enough to need an implementation plan.

**When to use:** Any task that requires an implementation plan — bug fixes spanning multiple files, new features, pipeline wiring, refactors that touch 3+ files, or anything involving cross-boundary changes (e.g., client-server, package-consumer).

**Core principle:** The first implementation plan is always a first draft. You MUST complete all 6 passes before presenting a plan as "ready for execution." Each pass has a specific adversarial lens.

---

## Pass 1: Forward Trace (Understand the Happy Path)

**Lens:** "What does this code do today?"

1. Trace the entry point — find the user action, API call, or trigger that starts the flow.
2. Follow every function call — read each file, note the exact line numbers.
3. Document the data shape at each boundary (function args, API request/response, DTOs).
4. Map the dependency chain — what packages, services, and external APIs are involved?
5. Identify the exit point — where does the result surface to the user?

**Output:** A trace document with every file involved and the data transformations at each step. Optionally include a Mermaid diagram.

**Self-check questions:**
- Can I draw the complete flow from trigger to user-visible result?
- Did I read every file in the chain, or did I assume any worked correctly?
- Are there parallel paths or branching logic I haven't followed?

---

## Pass 2: Inventory Audit (What exists but isn't connected?)

**Lens:** "What did I miss? What's built but not wired?"

1. Search for siblings — if you found FooService.ts, search for `*Service*` in the same directory. List ALL of them.
2. Search for pipelines — find every pipeline definition, not just the one currently called.
3. Check reference documents — look for design briefs, architecture docs, READMEs in the relevant directories. Check CLAUDE.md, PLAN.md, and any skill files.
4. Cross-reference — for every component in the trace, ask: "Is there a newer/better/more complete version of this that exists but isn't used?"
5. Check the user's stated goals — re-read the original request. Did you trace EVERYTHING they asked about, or did you answer a subset?

**Output:** An inventory table:

| Component | Code Exists? | Wired In? | Status |
|-----------|-------------|-----------|--------|

**Self-check questions:**
- Did I search broadly (glob patterns, not just exact names)?
- Did I check reference docs the user has open or in Downloads?
- Does my inventory cover 100% of the components in this domain, not just the ones currently used?

---

## Pass 3: Interface Contract Validation (Do the seams match?)

**Lens:** "Even if each piece works internally, do they fit together?"

For every boundary between systems (client-server, package-consumer, DTO-schema):

1. **Schema alignment** — compare field names, types, casing, and nesting between sender and receiver. PascalCase vs camelCase is a classic miss.
2. **Response envelope** — does the client expect flat data or a wrapper like `{ ok, data, error }`?
3. **Auth flow** — trace the auth token/key from storage to header to middleware to handler. Is every step connected?
4. **Import resolution** — can the importing package actually resolve the path? Check package.json exports, symlinks, barrel files (`index.ts`).
5. **Build compatibility** — check language versions, framework versions, and serialization library capabilities.
6. **Environment variables** — list every env var the code reads. Are they set in the deployment environment?

**Output:** A bug table:

| Bug # | Description | File:Line | Evidence |
|-------|-------------|-----------|----------|

**Self-check questions:**
- Did I literally compare the sender's output shape against the receiver's expected input shape, field by field?
- Did I check that every import path resolves?
- Did I verify env vars are set, not just referenced?

---

## Pass 4: Adversarial Audit (What breaks under stress?)

**Lens:** "What happens when things go wrong?"

1. **Timeout analysis** — what happens when external calls (APIs, DB, WebSocket, child processes) hang? Are there timeouts on every external call? What's the cascade if one times out?
2. **Memory analysis** — are there unbounded buffers, growing arrays, uncleaned event listeners, or streams that never close?
3. **Concurrency & race conditions** — are there concurrent writes? Stale reads? Ordering assumptions that could be violated? What if the same action fires twice simultaneously?
4. **Error path audit** — trace every catch block. Does it swallow errors silently? Does it leak internal details? Does it leave state inconsistent?
5. **Edge cases** — empty arrays, null values, missing optional fields, unicode, very long strings, zero-length inputs, negative numbers, boundary values.
6. **Security** — injection vectors (SQL, shell, XSS), auth bypasses, credential leaks in logs or error messages, SSRF, path traversal.
7. **Middleware ordering** — are middleware/interceptors in the right order? Does auth run before validation? Does logging capture errors?
8. **Deployment dependencies** — what happens if a dependency (DB, Redis, external API) is down at startup? Does the service crash or degrade gracefully?

**Output:** A risk table:

| Risk # | Severity | Description | Mitigation |
|--------|----------|-------------|------------|

**Self-check questions:**
- Did I trace every error path, not just the happy path?
- Did I check for silent failures (catch blocks that swallow errors)?
- Are there any unbounded operations?
- Did I verify timeouts exist on every external call?

---

## Pass 5: Expert Persona Audit (Would a specialist approve this?)

**Lens:** "What would a domain expert critique about this plan?"

1. **Identify relevant specialist personas** — based on the task domain, select 2-4 expert personas. Examples:
   - HIPAA Compliance Officer (healthcare/patient data)
   - Design Systems Lead (UI components, accessibility)
   - Database Architect (schema design, query performance, migrations)
   - Product Owner (feature completeness, user impact, edge cases)
   - Security Engineer (auth, encryption, attack surface)
   - DevOps Engineer (deployment, monitoring, rollback)
   - Performance Engineer (latency, throughput, resource usage)
2. **Generate adversarial critique prompts** — for each persona, ask: "If I showed this plan to a [persona], what would they flag as wrong, missing, or risky?"
3. **Document each persona's critique** — write out the specific concerns each expert would raise, with concrete examples.
4. **Integrate feedback** — update the plan to address legitimate concerns. Note which critiques you chose NOT to address and why.

**Output:** A persona feedback table:

| Persona | Concern | Severity | Addressed? | Resolution |
|---------|---------|----------|------------|------------|

**Self-check questions:**
- Did I pick personas relevant to THIS specific task, not generic ones?
- Did I actually change the plan based on feedback, or just acknowledge it?
- Would each persona sign off on the final plan?

---

## Pass 6: Plan Stress Test (Simulate execution before committing)

**Lens:** "If I execute this plan step by step right now, what goes wrong?"

1. **Simulate execution** — mentally walk through each step of the plan as if you're executing it. What file do you open first? What do you type? What happens next?
2. **Verify dependency ordering** — does step 3 depend on something created in step 5? Are there circular dependencies in the plan itself?
3. **Check verification feasibility** — for each step, can you actually verify it worked? What does "done" look like? How do you test it?
4. **Rollback safety** — if step 4 fails, can you undo steps 1-3? Is there a point of no return?
5. **Missing steps** — are there implicit steps you assumed but didn't write down? (e.g., "install dependency", "run migration", "restart server")
6. **Scope creep check** — does any step do more than what was asked? Does the plan introduce unnecessary complexity?

**Output:** An execution trace:

| Step | Action | Depends On | Verifiable? | Rollback? | Issues |
|------|--------|------------|-------------|-----------|--------|

**Self-check questions:**
- Did I find any ordering issues?
- Are there implicit assumptions I didn't write down?
- Is every step independently verifiable?
- Does the plan do exactly what was asked — no more, no less?

---

## Workflow Rules

1. **Complete all 6 passes before writing the implementation plan.** No exceptions.
2. **Loop back if needed.** If Pass 6 reveals issues, loop back to the relevant earlier pass and re-run it with the new information. Keep looping until Pass 6 produces no new issues.
3. **Split large plans.** If the implementation plan exceeds ~200 lines, split it into phases. Each phase should be independently deployable and verifiable.
4. **Stop when stable.** The protocol is complete when Pass 6 produces no changes to the plan. That's your signal to present it.

## THEN and ONLY THEN: Write Your Implementation Plan

Based on ALL 6 passes, write your plan. Reference specific findings from each pass. The plan should:

1. Address every bug found in Pass 3
2. Mitigate every risk identified in Pass 4
3. Incorporate expert feedback from Pass 5
4. Use existing components found in Pass 2 (don't rebuild what exists)
5. Follow the exact data flow mapped in Pass 1
6. Pass the execution simulation from Pass 6 without issues
