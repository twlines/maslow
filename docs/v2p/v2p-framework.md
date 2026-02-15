# The V2P Governance Framework

**Vibe-to-Production: A governance system for taking working software and proving it's production-ready, then keeping it that way autonomously.**

---

## Core Thesis

Production-grade software at scale has traditionally required large engineering organizations — not because the code is complex, but because the **governance** is complex. A 100-person team provides institutional knowledge, multi-perspective review, specialized security/ops/compliance oversight, feedback loops, and architectural coherence.

V2P encodes this governance as a **machine-readable, layered system**. The organizational DNA of a large engineering team becomes explicit structure that a small team + LLM agents can operate within.

> **Production-grade software is software where every behavior is specified, every specification is verified, every risk is explicitly addressed, and the system governing all of this adapts continuously.**

---

## The 6 Governance Layers

```
╔══════════════════════════════════════════════════════╗
║  L0  ENVIRONMENT                                     ║
║      External inputs: regulations, requirements,     ║
║      incidents, vendor changes, market shifts         ║
║      Authority: what the system must care about       ║
╠══════════════════════════════════════════════════════╣
║  L1  CONCERN MODEL                                   ║
║      Categories of production concern + risk weights  ║
║      Authority: what classes of risk matter            ║
╠══════════════════════════════════════════════════════╣
║  L2  DIMENSION SCHEMA                                 ║
║      Testable properties per concern                  ║
║      Includes inter-dimension constraints              ║
║      Authority: how each concern is measured           ║
╠══════════════════════════════════════════════════════╣
║  L3  CONTRACT CORPUS                                  ║
║      Per-unit specs + system invariants               ║
║      Structured as a dependency graph                 ║
║      Authority: what each unit promises                ║
╠══════════════════════════════════════════════════════╣
║  L4  VERIFICATION LAYER                               ║
║      Executable proofs derived from contracts         ║
║      Mode-aware: characterization vs specification    ║
║      Authority: what constitutes proof                 ║
╠══════════════════════════════════════════════════════╣
║  L5  IMPLEMENTATION + RUNTIME                         ║
║      Code + production behavior                       ║
║      The governed entities                            ║
╚══════════════════════════════════════════════════════╝
```

---

## The 7 Production Concerns (L1)

| #   | Concern         | Question                                                           |
| --- | --------------- | ------------------------------------------------------------------ |
| 1   | **Correctness** | Does it produce the right results, in the right order, atomically? |
| 2   | **Safety**      | Does it stay within its authorized scope?                          |
| 3   | **Resilience**  | Does it survive failures, load, and the unexpected?                |
| 4   | **Operations**  | Can we observe, trace, and debug it?                               |
| 5   | **Quality**     | Is the output right, not just present? Does it handle evolution?   |
| 6   | **Compliance**  | Does it satisfy legal/regulatory obligations?                      |
| 7   | **Economics**   | Can we afford to run it at scale?                                  |

### Risk Tiers

| Tier             | Concerns            | Blast Radius                            |
| ---------------- | ------------------- | --------------------------------------- |
| T1: Existential  | Safety, Compliance  | Data breach, lawsuit, regulatory action |
| T2: Functional   | Correctness         | Wrong results, data corruption          |
| T3: Operational  | Resilience          | Outages, cascading failures             |
| T4: Experiential | Operations, Quality | Silent degradation, debugging blindness |
| T5: Strategic    | Economics           | Unsustainable costs, scaling walls      |

The 7 concerns are defaults, not dogma. Add domain-specific concerns if needed, merge irrelevant ones. The principle is _"every production concern has a home."_

---

## The Integumentum (Connective Tissue)

Four mechanisms bind the layers:

| Mechanism              | Function                                                                            | Analog         |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------- |
| **Schema enforcement** | L2 defines the shape contracts must have. Invalid/incomplete contracts are rejected | Type system    |
| **Queryability**       | The corpus at L3 is structured data. Any property queryable across all units        | Graph database |
| **Propagation rules**  | Changes at any layer propagate to dependent layers with ACK lifecycle               | Event system   |
| **Signal routing**     | Production signals flow upward through defined paths                                | Immune system  |

### Propagation Lifecycle

Every propagation event has 4 possible responses:

| Signal       | Meaning                                             |
| ------------ | --------------------------------------------------- |
| ✅ COMPLETED | Change integrated at the target layer               |
| 🚫 BLOCKED   | Can't integrate — missing dependency or information |
| ⏸️ DEFERRED  | Acknowledged, prioritized for later (with deadline) |
| ❌ REJECTED  | Determined not applicable (with justification)      |

Propagation is tracked in existing project management tooling (e.g., GitHub Issues), not custom infrastructure. Each change → issue with sub-tasks per affected contract.

---

## The 5 Feedback Loops

| #   | Loop                     | Trigger                                | Effect                               |
| --- | ------------------------ | -------------------------------------- | ------------------------------------ |
| L1  | Real World → Concerns    | Incidents, regulations, vendor changes | Concern model evolves                |
| L2  | Code ↔ Contracts         | Code or contract changes               | Bidirectional staleness detection    |
| L3  | Corpus Queries           | New requirement or audit               | Instant cross-system impact analysis |
| L4  | Contracts → Architecture | Patterns across contracts              | Reveals refactoring opportunities    |
| L5  | Maturity → Depth         | Unit advances maturity level           | Progressive deepening of governance  |

---

## Two-Phase Governance Model

### Phase 1: Legislature (Human-in-the-Loop)

The domain expert validates each unit's contract — _"Is this what the flow should do?"_ This is the initial pass. The human is the bottleneck and this is unavoidable because only they know the intended behavior.

**Efficiency measures:**

- LLM drafts contracts; human reviews approve/reject
- Batch reviews by domain area (pipeline flows together, auth flows together)
- Standard clauses (derived from schema policy) don't need per-unit review

### Phase 2: Risk-Adaptive Autonomous Governance

Once contracts are approved, future changes validate automatically with **risk-adaptive gates**:

| Change Type                        | Gate Level      | Validation                                                      |
| ---------------------------------- | --------------- | --------------------------------------------------------------- |
| Code change (no model dependency)  | Auto            | CI: source stale → re-run tests → pass/fail                     |
| Code change (model-dependent flow) | Auto + semantic | CI + golden fixture regression check                            |
| New regulation                     | Auto            | Input port → query corpus → LLM updates contracts → CI verifies |
| New feature                        | Auto            | LLM generates contract from governance rules → CI verifies      |
| Schema dimension added             | Auto            | Additive-only → old contracts pick up at next re-verify         |
| Governance rule change             | **Human**       | Domain expert reviews L1/L2 changes                             |

**Human review surface: near-zero.** Code-level changes are fully automated. Model-dependent flows get automated semantic regression checks (golden fixtures). Human re-enters only for governance rule changes at L1-L2.

---

## Contract Design Principles

### Implementation-Precise

Contracts must be specific enough for autonomous implementation, not just descriptive.

| ❌ Descriptive         | ✅ Implementation-Precise                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| "Should sanitize PHI"  | "Should call `PHISanitizer.strip()` on all transcript fields before Firestore write"       |
| "Should handle errors" | "On Gemini API timeout: set `status: 'failed'`, write checkpoint, return without throwing" |

Implementation-precision is what makes autonomous code evolution possible. Descriptive contracts require human interpretation; precise contracts are executable specs.

### Why Contracts Are Permanent (Not Just a Context Window Workaround)

| Constraint       | Why It's Permanent                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| **Determinism**  | Descriptive specs have multiple valid implementations. Precise contracts make output deterministic            |
| **Verification** | Even a perfect LLM needs tests proving its output is correct. Precise contracts enable precise tests          |
| **Auditability** | A spec that lives in inference isn't governable. Compliance requires explicit, versioned, auditable artifacts |

### Co-Located with Source

Contracts live in the same file as the code they govern (as structured header blocks), not in separate files. This makes specification drift physically difficult — you see the contract while editing the code. A build-time extraction step generates the queryable corpus index.

### Additive-Only Schema Evolution (with Deprecation Lifecycle)

New dimensions can be ADDED but existing dimensions are never CHANGED (only deprecated). Old contracts continue working; new contracts include new dimensions. Old contracts pick up new dimensions at next re-verification. No migration scripts. No breaking changes.

**Deprecation lifecycle:** A deprecated dimension stays marked for 2 schema versions, then is removed. This prevents semantic accumulation — the schema stays clean and unambiguous over time.

---

## Two-Layer Contract Architecture

### Layer 1: Unit Contracts

Each functional unit gets its own contract. Contracts form a **dependency graph** — cascade chains, shared resources, competing rate limits. Changes to one node propagate along edges.

### Layer 2: System Invariants

Properties spanning the entire system. Tested once, not N times:

- Authorization consistency across all entry points
- Data governance across all sensitive-data handlers
- Integration integrity across all cascade chains
- Idempotency across all event-driven units

---

## Value Chain Outcomes (Layer 3.5)

Unit contracts ensure individual components work correctly. But correct units can compose into poor outcomes — structurally valid coaching that's useless, or engaging action items that lead to bad decisions.

**Value chain outcome contracts** sit between unit contracts (L3) and verification (L4). They check whether the _composition_ of correct units produces correct outcomes:

```yaml
value_chain:
  name: "coaching_pipeline"
  units: [F1, F3, F4, F5]
  outcome_signals:
    factual_traceability: "100% of coaching claims link to source data"
    acceptance_quality: "acted-upon recommendations show improvement in target metric"
    reversal_rate: "<10% of accepted recommendations are later dismissed"
    operational_impact: "targeted KPIs move in the predicted direction"
```

| Signal                   | What It Catches                                   |
| ------------------------ | ------------------------------------------------- |
| **Factual traceability** | Hallucinated or ungrounded claims                 |
| **Acceptance quality**   | Trivially easy but low-value recommendations      |
| **Reversal/regret rate** | Recommendations that don't hold up under scrutiny |
| **Operational impact**   | End-to-end "did this actually work" validation    |

Engagement metrics (views, clicks, completion rate) are _necessary_ but _not sufficient_. Harmful-but-engaging behavior passes engagement checks. Outcome signals catch what engagement misses.

---

## Governance Roles

The framework defines **5 role interfaces**. In a small team, one person fills all roles. As the team grows, roles separate for accountability and separation of duties.

| Role                  | Authority                                                                            | Scope        |
| --------------------- | ------------------------------------------------------------------------------------ | ------------ |
| **Schema Owner**      | Add/deprecate dimensions, modify risk tiers, approve schema changes                  | L1-L2        |
| **Contract Approver** | Validate T1/T2 contracts in Phase 1, approve behavioral clauses                      | L3           |
| **Incident Owner**    | Own retro actions, trigger V3 blindspot detection, update outcome signals            | L0→L1        |
| **Propagation Owner** | Ensure change records reach completion/rejection within SLAs                         | Integumentum |
| **Outcome Owner**     | Monitor value chain outcome signals, escalate degradation, evolve quality thresholds | L3.5         |

**Separation-of-duties principle:** No single role should both _author_ a contract and _approve_ it. In a 1-person team, this is an acknowledged risk that resolves with team growth — the framework flags it, not ignores it.

**Scaling behavior:**

- **1 person:** All roles, acknowledged risk
- **2-3 people:** Split Schema Owner from Contract Approver (minimum separation)
- **5+ people:** Full role separation

---

## Maturity Model

| Level | Name         | What Exists                                      | Confidence                                           |
| ----- | ------------ | ------------------------------------------------ | ---------------------------------------------------- |
| L0    | Undocumented | Code only                                        | "It works... I think"                                |
| L1    | Specified    | Contract + tests (T1-T2)                         | "It works correctly and safely"                      |
| L2    | Validated    | Domain expert approved                           | "It does what it should"                             |
| L3    | Hardened     | All tiers, monitoring, runbooks                  | "It's production-grade"                              |
| L4    | Evolved      | Contracts have driven architectural improvements | "It's proven and the system is better because of it" |

---

## Pipeline Execution Model

Process each unit through the full pipeline before starting the next. Order by **dependency graph** — upstream before downstream.

| Stage        | Question                       | Output               |
| ------------ | ------------------------------ | -------------------- |
| **Specify**  | "What does it do?"             | Contract + tests     |
| **Validate** | "Is that what it _should_ do?" | Approved contract    |
| **Harden**   | "Can it run in production?"    | Monitoring, runbooks |

---

## Vulnerabilities

Ranked by severity. Mitigations detailed in [v2p-risk-mitigations.md](file:///Users/trevorlines/.gemini/antigravity/brain/c4973b2f-d488-4b73-96a3-9ce08fe8a953/v2p-risk-mitigations.md).

| Tier        | #   | Vulnerability              | Weight |
| ----------- | --- | -------------------------- | ------ |
| Existential | V1  | Specification Drift        | 🔴 10  |
| Existential | V3  | Unmeasured Blindspot       | 🔴 9   |
| Critical    | V10 | Model/Provider Drift       | 🟠 8   |
| Critical    | V9  | Propagation Black Hole     | 🟠 8   |
| Critical    | V4  | Validate Bottleneck        | 🟠 8   |
| Critical    | V8  | Partial Adoption Asymmetry | 🟠 7   |
| Significant | V7  | Cost of Connectivity       | 🟡 6   |
| Significant | V2  | Schema Ossification        | 🟡 5   |
| Minor       | V6  | Granularity Mismatch       | 🟢 3   |
| Minor       | V5  | Feedback Oscillation       | 🟢 2   |

**Meta-vulnerability:** V2P converts implicit knowledge into explicit structure. Every piece of formalized knowledge is maintained structure. The system pays a permanent governance tax — mitigated by automating governance so it's cheap, not by doing less governance.

---

## Applicability

**Use V2P when:**

- ✅ Working software exists without formal specifications
- ✅ The system has grown organically
- ✅ A small team is operating at large-team complexity
- ✅ LLMs are used to build, and need machine-readable guardrails

**Do not use V2P when:**

- ❌ Building from scratch (use TDD/SDD — write specs first)
- ❌ The software is throwaway
- ❌ Fewer than ~10 functional units (just write tests directly)

---

## Document Map

| Document                    | Scope                                               |
| --------------------------- | --------------------------------------------------- |
| **v2p-framework.md** (this) | Abstract principles — project-agnostic              |
| **v2p-risk-mitigations.md** | Vulnerability mitigations — implementation guidance |
| _Project-specific:_         |                                                     |
| contract-schema.md          | Dimension definitions                               |
| implementation_plan.md      | Execution plan + progress                           |
| data-flow-contracts.md      | Unit catalog                                        |
