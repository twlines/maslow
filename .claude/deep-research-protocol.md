# Deep Research Protocol

Multi-pass deep research loop before any implementation plan is finalized. Required for any task large enough to need an implementation plan.

**When to use:** Any task that requires an implementation plan — bug fixes spanning multiple files, new features, pipeline wiring, refactors that touch 3+ files, or anything involving cross-boundary changes (e.g., client-server, package-consumer).

**Core principle:** The first implementation plan is always a first draft. You MUST complete all passes before presenting a plan as "ready for execution." Each pass has a specific adversarial lens.

---

## Pass 1: Forward Trace (Understand the Happy Path)

**Lens:** "What does this code do today?"

1. Trace the entry point — find the user action, API call, or trigger that starts the flow.
2. Follow every function call — read each file, note the exact line numbers.
3. Document the data shape at each boundary (function args, API request/response, DTOs).
4. Map the dependency chain — what packages, services, and external APIs are involved?
5. Identify the exit point — where does the result surface to the user?

**Output:** A trace document with a Mermaid diagram showing the flow, every file involved, and the data transformations at each step.

**Self-check questions:**
- Can I draw the complete flow from trigger to user-visible result?
- Did I read every file in the chain, or did I assume any worked correctly?
- Are there parallel paths or branching logic I haven't followed?

---

## Pass 2: Inventory Audit (What exists but isn't connected?)

**Lens:** "What did I miss? What's built but not wired?"

1. Search for siblings — if you found FooDisk.ts, search find_by_name `*Disk*` in the same directory. List ALL of them.
2. Search for pipelines — find every pipeline definition, not just the one currently called.
3. Check reference documents — look for design briefs, architecture docs, READMEs in the relevant directories. Check the user's Downloads folder and open editor tabs for context docs.
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
2. **Response envelope** — does the client expect flat data or a wrapper like `{ success, data, error }`?
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

## Workflow Rules

1. **Complete all 3 passes before writing the implementation plan.** No exceptions.
2. **Loop back if needed.** If Pass 3 reveals issues, loop back to the relevant earlier pass and re-run it with the new information. Keep looping until Pass 3 produces no new issues.
3. **Split large plans.** If the implementation plan exceeds ~200 lines, split it into phases. Each phase should be independently deployable and verifiable.
4. **Stop when stable.** The protocol is complete when Pass 3 produces no changes to the plan. That's your signal to present it.

## THEN and ONLY THEN: Write Your Implementation Plan

Based on ALL 3 passes, write your plan. Reference specific findings from each pass. The plan should:

1. Address every bug found in Pass 3
2. Use existing components found in Pass 2 (don't rebuild what exists)
3. Follow the exact data flow mapped in Pass 1
