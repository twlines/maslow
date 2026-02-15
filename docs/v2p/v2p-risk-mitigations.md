# V2P Risk Mitigations

Concrete strategies for each vulnerability identified in the [V2P Framework](file:///Users/trevorlines/.gemini/antigravity/brain/c4973b2f-d488-4b73-96a3-9ce08fe8a953/v2p-framework.md).

---

## Existential Tier

---

### V1: Specification Drift 🔴 10/10

**Threat:** Contracts and code diverge silently → false confidence.

#### Primary Mitigation: Co-Located Contracts

Contracts live in the same file as the code they govern, as structured header blocks. Drift becomes physically difficult — you see the contract while editing the code.

A build-time extraction step generates the **queryable corpus index** from all co-located contracts, preserving L3 queryability.

#### Secondary Mitigation: CI Staleness Gate

Every contract records the git hash of its source at verification time. CI checks:

- Modified source + non-updated contract hash = **blocked PR**
- Orphaned test (no contract clause) = **warning**
- Orphaned clause (no test) = **blocked PR**

#### Residual Risk

CI gate only catches drift on files that are modified. A contract wrong from day 1 (bad extraction) isn't caught by drift detection — that's V3's territory.

---

### V3: Unmeasured Blindspot 🔴 9/10

**Threat:** The schema only measures dimensions it defines. The undefined dimension is the one that causes the incident.

#### Primary Mitigation: Proactive Pre-Flight (Dimension Generators)

Before any new flow enters the system, run adversarial questions **outside** the dimension schema:

- _"What's the worst thing this flow could do with hostile input?"_
- _"What if a dependency returns plausible but wrong data?"_
- _"If this ran 1000× concurrently, what breaks?"_
- _"What can a malicious insider do with this flow's data access?"_

These aren't dimension checks — they're **dimension generators**. The answers reveal whether new dimensions are needed.

#### Secondary Mitigation: Incident Retrospective

Every production incident triggers: _"Which dimension should have caught this?"_

- Existing dimension should have caught it → contract was incomplete → update
- No dimension covers it → **schema gap** → add dimension (additive-only)

#### Tertiary Mitigation: Declared Confidence Boundary

The framework explicitly states: _"V2P provides governance across N dimensions. Risks outside these dimensions are not covered. The schema grows through incident learning and adversarial review."_

Transforms the blindspot from a hidden vulnerability into a **declared boundary**.

---

## Critical Tier

---

### V9: Propagation Black Hole 🟠 8/10

**Threat:** Changes enter the system but there's no confirmation they reached all affected layers.

#### Mitigation: GitHub Issues as Propagation Ledger

No custom tooling. Each external change → **GitHub Issue** with sub-tasks per affected contract:

```
Issue: "HIPAA update: audit trail must include user_id"
  ├── [ ] F3: Intelligence Extraction         → COMPLETED
  ├── [ ] F4: Analysis Post-Processing        → DEFERRED (blocked on F3)
  ├── [ ] F17: Desktop Clinical Intelligence  → BLOCKED (no audit infra)
  └── [x] F35: Admin Config                   → REJECTED (no PHI access)
```

Standard issue tracking handles ACK/NACK lifecycle natively. Issue stays open until all sub-tasks are resolved.

**Automation rules** (to prevent ledger rot):

- Stale sub-task alert after **14 days** with no status update
- Blocked items surface in **weekly summary**
- Issue cannot close until all sub-tasks are COMPLETED or REJECTED (not DEFERRED)
- DEFERRED items require a deadline; deadline breach → auto-escalation

---

### V10: Model/Provider Drift 🟠 8/10

**Threat:** An LLM model version change (e.g., Gemini 2.0 → 2.5) produces outputs that pass all structural contract tests but differ in semantic quality. The output is technically valid but the _meaning_ has shifted.

#### Mitigation: Golden Fixture Regression Tests

For every model-dependent flow, maintain **golden input/output pairs** — known-good examples where the expected output is human-verified:

```yaml
golden_fixtures:
  - input: "Dr. Smith discussed crown preparation with patient..."
    expected_outputs:
      - contains: ["crown preparation", "treatment plan"]
      - quality_check: "action items are specific and actionable"
      - regression_baseline: "golden/F3/transcript-001.json"
```

When a model version changes, golden fixtures run automatically. Structural tests verify format; golden fixtures verify **meaning stays stable**.

#### Residual Risk

Golden fixtures only catch drift against known examples. Novel inputs with no golden fixture are unprotected. Mitigate by growing the golden set from production samples over time.

---

### V4: Validate Bottleneck 🟠 8/10

**Threat:** System produces review work faster than humans process it.

#### Mitigation: Two-Phase Governance

**Phase 1 (initial pass):** Human validates each contract. Unavoidable — only the domain expert knows intended behavior. Efficiency measures:

- LLM drafts contracts; human reviews approve/reject
- Batch by domain area
- **Standard clauses** (from schema policy) are pre-validated — only **behavioral clauses** need human review

**Phase 2 (ongoing):** Risk-adaptive autonomous governance. Code-level changes are fully automated. Model-dependent flows get automated semantic regression checks (golden fixtures). Human review surface is near-zero — human re-enters only if governance rules themselves change at L1-L2.

---

### V8: Partial Adoption Asymmetry 🟠 7/10

**Threat:** Partial coverage creates false confidence in the most dangerous areas.

#### Mitigation: Risk-Weighted Ordering + Declared Boundaries

- Process flows in **dependency-graph order**, highest risk first (no cherry-picking easy flows)
- Coverage dashboard: X/N contracted, which maturity level, which areas uncovered
- Explicit declaration: _"These flows have NO governance coverage. Treat as unverified."_
- For low-priority flows: **lightweight contracts** (T1 only) provide 80% safety value at 20% cost

---

## Significant Tier

---

### V7: Cost of Connectivity 🟡 6/10

**Threat:** Governance overhead exceeds the value it provides.

#### Mitigation: Automate to Make It Cheap

The cost of governance is proportional to **manual effort**, not to number of contracts:

- Contract extraction: **LLM-automated**
- Test generation: **template-driven** from contract clauses
- Drift detection: **CI-automated** (hash checks)
- Propagation tracking: **GitHub Issues** (existing tooling)

Automate the expensive parts → marginal cost of each new contract approaches zero.

---

### V2: Schema Ossification 🟡 5/10

**Threat:** Schema changes are expensive when many contracts exist.

#### Mitigation: Additive-Only Schema Evolution + Deprecation Lifecycle

- New dimensions can be **ADDED** but never changed (only deprecated)
- Old contracts continue working with no updates required
- New contracts include new dimensions
- Old contracts pick up new dimensions at next re-verification
- No migration scripts. No breaking changes. No bulk updates

**Deprecation lifecycle** (prevents semantic accumulation):

- Deprecated dimension marked with `deprecated_in: <schema_version>`
- Stays visible for **2 schema versions** as warning
- After 2 versions: removed from schema, existing contract references produce linter warnings
- All deprecations tracked in schema changelog

---

## Minor Tier

---

### V6: Granularity Mismatch 🟢 3/10

**Mitigation:** The query engine at L3 bridges the gap. Regulation-level requirement → corpus query → function-level results. Improve query expressiveness as needed.

### V5: Feedback Oscillation 🟢 2/10

**Mitigation:** Human checkpoints naturally damp oscillation. If automated propagation is added, enforce cooldown: no contract updated more than once per 24h from automated signals.

---

## Vulnerability Interaction Map

```
V1  (Drift) + V8  (Partial)   = Partial coverage that's also unreliable
V3  (Blindspot) + V4 (Bottleneck) = Can't find gaps AND can't review fast enough
V7  (Cost) + V2  (Ossification) = Expensive to maintain AND expensive to change
V10 (Model Drift) + V3 (Blindspot) = Semantic degradation in unmeasured areas
```

**Mitigation implementation order:**

1. **V1** — co-located contracts + CI gate (foundational)
2. **V3** — pre-flight adversarial questions + incident retro process (continuous)
3. **V10** — golden fixture regression tests for model-dependent flows
4. **V9** — GitHub Issues as ledger with automation rules
5. **V8** — coverage dashboard + risk ordering (visibility)
6. **V4** — risk-adaptive governance model (operational)
7. V7, V2, V6, V5 — addressed as system scales
