# Confidential Computing for Aiden: Research Synthesis

**Date:** 2026-02-15
**Author:** Maslow (autonomous research)
**Origin:** Komoroske interview + confidential compute research brief
**Status:** Complete — ready for review

---

## Executive Summary

Aiden processes Protected Health Information (PHI) across dental practice boundaries — recordings, clinical notes, team dynamics, billing data. Today, trust = "trust Aiden Inc." This research investigates whether confidential computing and data-centric policy enforcement can structurally guarantee that PHI is never exposed, even to the platform operator.

**Bottom line:** The technology is real and maturing fast, but Aiden is 12-18 months early for a full confidential compute deployment. The right move is to build the policy architecture now (using Effect-TS's type system) and slot hardware enforcement in later when GPU TEEs and confidential AI services reach production maturity.

---

## 1. Landscape Map

### What Exists and Works Today

| Technology | Maturity | Performance | Healthcare Use | Notes |
|---|---|---|---|---|
| **AMD SEV-SNP** | Production (Azure, GCP, AWS) | 2-5% overhead | Yes (Azure HC) | Best attestation model, production since 2022 |
| **Intel TDX** | Production (Azure, GCP) | 3-8% overhead | Limited | Trust Domain Extensions, newer than SEV-SNP |
| **AWS Nitro Enclaves** | Production | Minimal overhead | Yes | Simpler model (no GPU), good for key management |
| **NVIDIA H100 CC Mode** | Early production (Azure NCCads) | <5% for LLM inference | Experimental | GPU confidential computing — the key unlock for AI |
| **ARM CCA** | Pre-production | Unknown | No | Mobile-first, relevant for dental IoT long-term |
| **Cedar (AWS)** | Production | 42-60x faster than Rego | Yes | Best policy engine for healthcare authorization |
| **OPA/Rego** | Production | Moderate | Yes | General-purpose, large ecosystem |
| **SpiceDB (Zanzibar)** | Production | Fast | Some | Relationship-based access control, good for org hierarchies |
| **Effect-TS branded types** | Production | Zero runtime cost | Novel use | R channel as policy phantom types — our innovation |
| **SES/Hardened JS** | Production | Moderate | No | Capability-based sandboxing for Node.js |

### What's Promising but Not Ready

| Technology | Status | Blocker | ETA |
|---|---|---|---|
| **Multi-GPU CC** | Lab/preview | H100 CC only supports single GPU, no multi-GPU training | 2027+ |
| **Confidential Kubernetes** | Preview (Azure AKS-CC, Edgeless Constellation) | Operational complexity, limited GPU support | Late 2026 |
| **Privacy type systems (IFC)** | Research | No production TypeScript implementation | Custom work |
| **Komoroske's "Coactive Fabric"** | Vision only | Common Tools has shipped zero product | Unknown |
| **Cross-enclave attestation mesh** | Early (MarbleRun, Ego) | Complex setup, limited cloud support | 2026-2027 |

### What's Vaporware

| Technology | Why |
|---|---|
| **Common Tools (Komoroske)** | Brilliant thinker, zero shipped product. Vision is worth stealing; don't wait for him to build it |
| **Full DIFC in TypeScript** | No existing library. Would require building from scratch. Academic implementations exist in Java (Jif), Haskell (LIO/MAC), Rust (Cocoon) — none in TS |
| **Zero-Knowledge ML** | 10,000x overhead. Not viable for LLM inference workloads |
| **Homomorphic encryption for LLMs** | Even worse overhead than ZK. Decades away for complex computation |
| **Web3 confidential compute** (iExec, Oasis, Secret) | Overcomplicated, tied to blockchain economics, no healthcare traction |

---

## 2. Architecture Sketch: Aiden Under Confidential Compute

### Current Architecture (Trust-the-Vendor)

```
Practice A EHR ──► Firebase/Cloud Functions ──► OpenAI/Anthropic API ──► Firestore ──► Dashboard
                   (trust Aiden Inc.)           (trust LLM provider)    (trust GCP)   (trust Vercel)
```

Every arrow is a trust boundary where PHI could leak. HIPAA BAA = legal trust, not structural trust.

### Target Architecture (Data-Centric Trust)

```
                    ┌──────────────────────────────────────────────────┐
                    │         Confidential Compute Boundary            │
                    │         (AMD SEV-SNP / H100 CC Mode)             │
                    │                                                  │
Practice A EHR ──►  │  ┌─────────┐    ┌──────────┐    ┌───────────┐  │
  [label: {A->A}]   │  │Ingestion│───►│ AI Triad │───►│ De-Ident  │  │ ──► Aggregated Insights
                     │  │ Service │    │ Pipeline │    │   Gate    │  │     [label: {public}]
Practice B EHR ──►  │  └─────────┘    └──────────┘    └───────────┘  │
  [label: {B->B}]   │                                                  │
                    │  Attestation: "This code, this data, these      │
                    │   policies. Verifiable. Auditable. No escape."  │
                    └──────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Transparency Log  │
                    │  (Sigstore/Rekor)  │
                    │  Runtime hashes    │
                    │  Attestation proof │
                    └───────────────────┘
```

### The Four Enforcement Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: Hardware Enforcement (TEEs)                           │
│  AMD SEV-SNP / NVIDIA H100 CC / Nitro Enclaves                 │
│  Encrypted memory, remote attestation, no admin access          │
│  WHEN: Phase 3+ (2027)                                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Contextual Integrity Audit                            │
│  "Is this flow appropriate in this context?"                    │
│  Five-parameter norm checking (subject, sender, recipient,      │
│  info type, transmission principle)                              │
│  WHEN: Phase 2 (2026 H2)                                        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Policy-as-Code (Cedar)                                │
│  "Is this request authorized?"                                  │
│  Practice-scoped access, role-based perms, cross-practice rules │
│  WHEN: Phase 1 (2026 Q2)                                        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Type-Level Policy Enforcement (Effect-TS)             │
│  "Does this code satisfy its data policies?"                    │
│  R channel phantom types, branded PHI types, declassification   │
│  gates, compile-time verification                                │
│  WHEN: Phase 0 — build now                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 0: Effect-TS Policy Architecture (Build Now)

This is the immediate architectural investment. It costs nothing in infrastructure and gives us 70-80% of the policy enforcement value through the compiler.

```typescript
// --- Data Classification (Branded Types) ---

import { Brand, Context, Effect, Layer } from "effect"

// PHI brand — cannot be passed where Public is expected
type PHI<T> = T & Brand.Brand<"PHI">
const PHI = Brand.nominal<PHI<string>>()

type DeIdentified<T> = T & Brand.Brand<"DeIdentified">
const DeIdentified = Brand.nominal<DeIdentified<string>>()

type Public<T> = T & Brand.Brand<"Public">

// --- Policy Tags (Context.Tag as Policy Requirements) ---

// Any computation touching PHI must satisfy these policies
class HIPAAPolicy extends Context.Tag("HIPAAPolicy")<
  HIPAAPolicy,
  {
    readonly attestation: string
    readonly auditAccess: (event: string) => Effect.Effect<void>
  }
>() {}

class PracticeScope extends Context.Tag("PracticeScope")<
  PracticeScope,
  {
    readonly practiceId: string
    readonly consentVerified: boolean
  }
>() {}

class EncryptionRequired extends Context.Tag("EncryptionRequired")<
  EncryptionRequired,
  { readonly algorithm: "AES-256-GCM"; readonly keyId: string }
>() {}

// --- Declassification Gate ---

// The ONLY way to go from PHI -> DeIdentified
// Requires both HIPAA attestation AND anonymization proof
class AnonymizationProof extends Context.Tag("AnonymizationProof")<
  AnonymizationProof,
  {
    readonly method: "k-anonymity" | "differential-privacy"
    readonly parameter: number // k value or epsilon
    readonly verified: boolean
  }
>() {}

const deIdentify = (
  data: PHI<PatientRecord>
): Effect.Effect<
  DeIdentified<AggregateStats>,
  DeIdentificationError,
  HIPAAPolicy | AnonymizationProof
> =>
  Effect.gen(function* () {
    const hipaa = yield* HIPAAPolicy
    const proof = yield* AnonymizationProof

    yield* hipaa.auditAccess("de-identification-gate")

    // ... perform de-identification ...
    return result as DeIdentified<AggregateStats>
  })

// --- Pipeline Composition ---
// R channel accumulates ALL policy requirements

const pipeline = fetchPatientData.pipe(       // R: PracticeScope | EncryptionRequired
  Effect.flatMap(extractIntelligence),        // R: + HIPAAPolicy
  Effect.flatMap(deIdentify),                 // R: + AnonymizationProof
  Effect.flatMap(publishBenchmark),           // R: (cleared — output is DeIdentified)
)
// TypeScript compiler REJECTS this unless ALL policy layers are provided
```

**What this buys us:**
- Every function that touches PHI declares it in its type signature
- The compiler catches policy violations at build time
- Declassification (PHI -> DeIdentified) requires explicit proof
- Policy requirements compose automatically through Effect.flatMap
- Zero runtime overhead — phantom types are erased

**What this does NOT cover:**
- Implicit information flows (branching on PHI to produce public output)
- Runtime policy enforcement (a bug or `as any` cast can bypass)
- Hardware guarantees (needs TEE layer for structural enforcement)

### Phase 1: Cedar Policy Engine (2026 Q2)

Add Cedar as the runtime authorization layer:

```cedar
// Practice-scoped PHI access
permit (
    principal in Role::"Dentist",
    action == Action::"ReadPHI",
    resource in PracticeRecords
) when {
    principal.practice_id == resource.practice_id
};

// Cross-practice: only de-identified
permit (
    principal == Service::"BenchmarkPipeline",
    action == Action::"ReadForAnalysis",
    resource
) when {
    resource.de_identified == true &&
    context.has_baa == true
};

// Blanket deny on cross-practice identified data
forbid (
    principal,
    action == Action::"ReadPHI",
    resource
) when {
    principal.practice_id != resource.practice_id &&
    resource.de_identified == false
};
```

Cedar runs in ~0.1ms per evaluation, is formally verified (Lean 4), and has Node.js bindings via `@cedar-policy/cedar-wasm`.

### Phase 2: Contextual Integrity Audit (2026 H2)

Log every data flow with Nissenbaum's five parameters:

```typescript
interface DataFlowEvent {
  subject: string       // Whose data? "Patient Jones"
  sender: string        // Who transmitted? "Practice A EHR"
  recipient: string     // Who received? "AI Triad Pipeline"
  infoType: string      // What kind? "treatment_outcomes"
  transmission: string  // Under what rule? "clinical_analysis_with_baa"
  context: string       // Which context? "benchmarking"
  timestamp: number
  policyDecision: "allow" | "deny"
  cedarPolicyId: string
}
```

Flag any flow that doesn't match a defined norm. Build a patient-facing audit trail.

### Phase 3: Hardware Enforcement (2027+)

When NVIDIA H100 CC and Azure NCCads mature:
- Run the intelligence extraction pipeline (Triad/PDM/PatientConv) inside a confidential VM
- Remote attestation proves to each practice that their data is processed by verified code
- Transparency log (Sigstore/Rekor) publishes runtime hashes
- Even Aiden Inc. cannot see raw cross-practice PHI — structurally impossible

---

## 3. Code Inventory

### Production-Ready Libraries

| Library | Language | Purpose | License | Notes |
|---|---|---|---|---|
| **@cedar-policy/cedar-wasm** | Rust→WASM→Node.js | Authorization policy engine | Apache 2.0 | AWS-backed, formally verified |
| **Effect Brand module** | TypeScript | Nominal/refined branded types | MIT | Already in our stack |
| **Effect Context.Tag** | TypeScript | Policy-as-phantom-types | MIT | Already in our stack |
| **@anthropic-ai/sdk** | TypeScript | LLM inference (non-enclave) | MIT | Current provider |
| **ses** (Hardened JS) | JavaScript | Capability-based sandboxing | Apache 2.0 | Agoric-backed, used by MetaMask |
| **opa-wasm** | Rust→WASM | OPA policy evaluation | Apache 2.0 | Alternative to Cedar |
| **@authzed/authzed-node** | TypeScript | SpiceDB client (ReBAC) | Apache 2.0 | Zanzibar-based, good for org hierarchies |
| **presidio** | Python | PHI/PII de-identification | MIT | Microsoft, NER-based |
| **philter** | Java | PHI de-identification | Apache 2.0 | Regex + NER |

### Research-Grade / Worth Evaluating

| Library/System | Language | Purpose | Notes |
|---|---|---|---|
| **Fortanix Enclave Manager** | Rust/C | TEE orchestration | Best healthcare CC platform (UCSF proof) |
| **Edgeless Contrast** | Go | Confidential Kubernetes | Open-source, CNCF member |
| **MarbleRun** | Go | Multi-enclave attestation mesh | Edgeless Systems |
| **EGo** | Go | SGX enclave development | Easiest on-ramp to enclave dev |
| **Decentriq** | Proprietary | Confidential data clean rooms | Cross-org health data analytics |
| **Flower (flwr)** | Python | Federated learning framework | Run models without centralizing data |
| **ifc-ts** | TypeScript | Information flow control types | Academic, unmaintained, but useful reference |
| **Jif** | Java | Full IFC type system | Reference implementation of DLM |
| **Cocoon** | Rust | Static IFC via proc macros | Most impressive IFC-in-real-language |

### SDKs for Confidential Computing

| SDK | Cloud | Purpose |
|---|---|---|
| **Azure Attestation SDK** | Azure | Remote attestation verification |
| **Azure Confidential Ledger SDK** | Azure | Tamper-proof audit log |
| **AWS Nitro Enclaves SDK** | AWS | Enclave development + KMS integration |
| **GCP Confidential Space** | GCP | Multi-party confidential VMs |
| **NVIDIA GPU TEE SDK** | Any (H100) | GPU confidential computing |

---

## 4. Gap Analysis: Komoroske's Vision vs. Reality

### What Komoroske Describes

1. **Data-attached policies** — policies travel with data, enforced by runtime
2. **Privacy type-checking** — computation graphs verified against policies before execution
3. **Coactive fabric** — mesh of mutually-untrusted nodes with attestation
4. **Iron triangle resolution** — untrusted code + sensitive data + network, all safe
5. **Contextual integrity** — data used only in appropriate contexts
6. **LLMs as secure intermediaries** — AI processes data without seeing it
7. **MCP replacement** — tool execution constrained by data policies, not prompt instructions

### What's Buildable Today

| Komoroske Concept | Buildable? | How | Gap |
|---|---|---|---|
| Data-attached policies | **Yes (type-level)** | Effect-TS R channel + branded types | No runtime enforcement without TEE |
| Privacy type-checking | **Partial** | Compile-time policy verification via phantom types | No implicit flow tracking, no lattice ordering |
| Coactive fabric | **No** | MarbleRun + Constellation can approximate | No production multi-party confidential mesh |
| Iron triangle resolution | **Partial** | Single-enclave computation works today | Multi-node coordination is immature |
| Contextual integrity | **Yes** | Cedar policies + audit logging | Needs custom norm definition per context |
| LLMs in enclaves | **Experimental** | Azure NCCads H100 + Ollama/vLLM | <5% overhead, but limited to single GPU |
| MCP replacement | **Possible** | Cedar + capability-based tool auth + Biscuit tokens | No off-the-shelf solution, custom build |

### The Real Gaps

1. **GPU TEE maturity**: H100 CC mode works but is limited to single GPU. Multi-GPU training/inference in enclaves is 18+ months away. Aiden's pipeline fits single-GPU inference today.

2. **TypeScript IFC**: No production IFC library for TypeScript. Cocoon (Rust) and LIO (Haskell) are the best references. We would be building the first serious IFC-in-Effect-TS implementation. This is greenfield.

3. **Cross-practice attestation**: Each practice needs to verify that Aiden's enclave is running exactly the expected code. The attestation flow exists (AMD VCEK/VLEK, Azure MAA) but the UX for non-technical dental practice administrators is unsolved.

4. **De-identification quality**: k-anonymity and differential privacy have known limitations for small datasets. A single dental practice may have too few patients for strong anonymization guarantees. This is a data science problem, not a CC problem.

5. **No dental-specific CC deployment exists**: Zero dental platforms use confidential computing. BeeKeeperAI is the closest (healthcare ML in enclaves) but not dental. We would be first-movers. Risk and reward.

---

## 5. Decision Document

### Should Aiden Invest Now?

**Recommendation: Yes, but phased. Build the policy architecture now. Deploy hardware enforcement later.**

### The Argument For

1. **First-mover in dental confidential compute.** No dental platform has this. Flatiron Health (oncology), Tempus (genomics), and Truveta (health systems) all use data-centric approaches but none use confidential computing. Dental is wide open.

2. **Structural differentiation.** "We literally cannot see your data" is a fundamentally different trust proposition than "We promise not to look at your data." In a market where HIPAA violations cost $100-$50K per incident, structural privacy is a competitive moat.

3. **Effect-TS is uniquely suited.** The R channel / Context.Tag / branded type pattern is the closest any mainstream language ecosystem gets to compile-time policy enforcement. This isn't bolted on — it's native to our architecture.

4. **The policy layer costs almost nothing.** Phase 0 (type-level policy enforcement) requires zero new infrastructure. It's a code pattern change, not a deployment change. The ROI is immediate: every PHI-touching function declares its policy requirements in its type signature.

5. **Komoroske is right about the direction.** Even if his company ships nothing, the thesis — data-centric trust replacing origin-centric trust — is aligned with every major cloud vendor's confidential computing roadmap (Azure, GCP, AWS all have CC offerings growing fast).

### The Argument Against

1. **Aiden is pre-revenue.** Spending engineering cycles on confidential computing before achieving product-market fit risks premature optimization of the wrong thing.

2. **The hardware isn't fully ready.** GPU TEEs are single-GPU only. Multi-GPU inference requires workarounds. The operational complexity of running in enclaves is high.

3. **Dental practices don't ask for this.** No dental practice has ever asked "do you use confidential computing?" They ask "are you HIPAA compliant?" The market may not value structural privacy enough to pay for it.

4. **IFC in TypeScript is uncharted.** We would be building novel infrastructure with no community support. If we get it wrong, it's wasted effort.

### The Phased Investment

| Phase | When | Investment | Outcome |
|---|---|---|---|
| **0: Policy Types** | Now | 2-3 weeks eng | Every PHI function has compile-time policy requirements |
| **1: Cedar** | 2026 Q2 | 1-2 weeks eng | Runtime authorization with formally verified policies |
| **2: CI Audit** | 2026 H2 | 1 week eng | Full data flow audit trail with contextual integrity |
| **3: Hardware CC** | 2027 | 4-6 weeks eng + infra | Intelligence pipeline runs in attested enclaves |

**Phase 0 is the key decision.** It's cheap, it's native to our stack, and it creates the architectural foundation that makes Phases 1-3 possible. If we build the policy architecture into the Effect-TS pipeline now, slotting in Cedar, audit logging, and eventually hardware enforcement becomes straightforward. If we don't, we'll have to retrofit it later — and retrofitting IFC onto an existing codebase is an order of magnitude harder than building it in from the start.

### What to Do Monday

1. Define the PHI branded type and policy Context.Tags for Aiden's intelligence pipeline
2. Refactor `processRecording` to require `HIPAAPolicy | PracticeScope | EncryptionRequired` in its R channel
3. Build the de-identification declassification gate
4. Write the Cedar policy file for practice-scoped PHI access
5. Ship it. Iterate. The architecture evolves with the product.

---

## Appendix: Key Sources

### Komoroske & Vision
- [Every.to podcast transcript](https://every.to/podcast/transcript-24731afb-3ef5-412c-bcfe-69f0d769b45e)
- [Why Aggregators Ate the Internet](https://every.to/thesis/why-aggregators-ate-the-internet)
- [Resonant Computing Manifesto](https://resonantcomputing.org/) (December 2025)
- [Komoroske X post — Private Intelligence](https://x.com/komorama/status/1916867022819922015)

### Confidential Computing
- [CCC Technical Analysis v1.3](https://confidentialcomputing.io/wp-content/uploads/sites/10/2023/03/CCC-A-Technical-Analysis-of-Confidential-Computing-v1.3_unlocked.pdf)
- [AMD SEV-SNP White Paper](https://www.amd.com/content/dam/amd/en/documents/epyc-technical-docs/white-papers/SEV-SNP-strengthening-vm-isolation-with-integrity-protection-and-more.pdf)
- [Azure Confidential Computing](https://learn.microsoft.com/en-us/azure/confidential-computing/)
- [NVIDIA H100 Confidential Computing](https://developer.nvidia.com/confidential-computing)

### Information Flow Control
- Myers & Liskov, "Protecting Privacy using the Decentralized Label Model" (TOSEM 2000)
- Krohn et al., "Information Flow Control for Standard OS Abstractions" (SOSP 2007)
- Cheng et al., "Abstractions for Usable Information Flow Control in Aeolus" (USENIX ATC 2012)
- Hirsch & Cecchetti, "Cocoon: Static IFC in Rust" (OOPSLA 2024)
- Stefan et al., "Flexible Dynamic IFC in Haskell" (Haskell Symposium 2011)

### Privacy & Healthcare
- Nissenbaum, "Privacy as Contextual Integrity" (Washington Law Review, 2004)
- Shirky, "Situated Software" (2004)
- Vendrov, "The Tyranny of the Marginal User"
- HIPAA Technical Safeguards (45 CFR 164.312)

### Policy Engines
- [Cedar Language Reference](https://docs.cedarpolicy.com/)
- [OPA Documentation](https://www.openpolicyagent.org/docs/latest/)
- [SpiceDB / Zanzibar](https://authzed.com/docs/spicedb/concepts/zanzibar)

### Capability Security
- [Hardened JavaScript (SES)](https://docs.agoric.com/guides/js-programming/hardened-js)
- [Cap'n Proto RPC](https://capnproto.org/rpc.html)
- [Endo/SES GitHub](https://github.com/endojs/endo)
