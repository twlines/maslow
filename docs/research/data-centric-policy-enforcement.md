# Data-Centric Policy Enforcement & Information Flow Control

## Research Brief for Aiden Platform -- Dental PHI Across Practice Boundaries

---

## 1. Information Flow Control (IFC)

### Core Concept

Information Flow Control is a security discipline that attaches **security labels** to data and enforces policies on how labeled data can move through computation. Unlike access control (which gates entry to resources), IFC tracks data *after* access is granted, ensuring it cannot leak to unauthorized destinations through any computational path.

### Lattice-Based Models

IFC is grounded in **lattice theory**. Security labels form a mathematical lattice with a partial order (less-restrictive to more-restrictive), a join operation (least upper bound), and a meet operation (greatest lower bound). Every piece of data carries a label; every computation context (process, thread, variable) also carries a label. The system enforces that information only flows "upward" in the lattice.

**Bell-LaPadula Model (Confidentiality)**
- **Simple Security Property**: "No read up" -- a subject at clearance level L cannot read an object classified above L.
- **Star Property**: "No write down" -- a subject at clearance level L cannot write to an object classified below L.
- Prevents information from leaking from high-classification to low-classification contexts.
- Originally designed for military multi-level security (Top Secret > Secret > Confidential > Unclassified).

**Biba Integrity Model**
- The dual of Bell-LaPadula, focused on data **integrity** rather than confidentiality.
- **Simple Integrity Property**: "No read down" -- a subject cannot read from a lower-integrity source (prevents contamination).
- **Star Integrity Property**: "No write up" -- a subject cannot write to a higher-integrity destination (prevents corruption of trusted data).
- Critical for healthcare: you need both confidentiality (PHI cannot leak) and integrity (clinical data cannot be corrupted by untrusted inputs).

### Mapping to Dental PHI

In a dental AI platform processing PHI across practices:

| IFC Concept | Dental Mapping |
|---|---|
| Security Level | Practice boundary (Practice A, Practice B, Aggregated/De-identified) |
| Subject | AI pipeline stage, API endpoint, analytics worker |
| Object | Patient record, treatment plan, clinical image, billing record |
| "No read up" | A Practice-A-scoped worker cannot read Practice-B raw PHI |
| "No write down" | Aggregated analytics cannot be reverse-written to enrich individual patient records without re-authorization |
| Integrity labels | Clinical data from a licensed provider has higher integrity than patient self-reported data |

The lattice for a multi-practice dental platform might look like:

```
          [Aggregated De-identified]     -- highest confidentiality (paradoxically most sharable)
               /          \
    [Practice A PHI]    [Practice B PHI]  -- practice-scoped, incomparable
               \          /
          [Cross-Practice PHI]            -- requires consent from both practices
```

But this is not a simple linear hierarchy -- practice scopes are **incomparable** in the lattice (neither is "above" the other), which is precisely why you need DIFC rather than classical MLS.

### Production Implementations

- **SELinux MLS mode**: Kernel-enforced Bell-LaPadula on Linux. Labels on files, processes, sockets.
- **SMACK (Simplified Mandatory Access Control Kernel)**: Lighter-weight Linux Security Module with label-based enforcement.
- **Trusted Solaris / Trusted Extensions**: Solaris with mandatory labels on all objects.
- None of these are directly applicable to application-layer TypeScript pipelines, but they establish the theoretical foundation.

### Key Papers

- D.E. Bell & L.J. LaPadula, "Secure Computer Systems: Mathematical Foundations" (1973)
- K.J. Biba, "Integrity Considerations for Secure Computer Systems" (1977)
- D. Denning, "A Lattice Model of Secure Information Flow" (1976) -- the paper that unified IFC with lattice theory

---

## 2. Decentralized IFC (DIFC)

### The Problem DIFC Solves

Classical IFC assumes a **central authority** that assigns security levels. This breaks down when:
- Multiple mutually distrusting parties contribute data (dental practices that compete with each other)
- No single entity should have unilateral power to declassify data
- Policies must compose when data from different sources is combined

DIFC allows each **principal** (practice, patient, provider) to define their own security policies on their own data, and the system ensures these policies are enforced even as data flows through shared computation.

### The Decentralized Label Model (DLM) -- Myers & Liskov

The foundational DIFC model, introduced in SOSP 1997 and refined in TOSEM 2000.

**Core concepts:**

**Principals**: Entities with security concerns -- users, groups, roles, organizations. In dental: `PracticeA`, `PracticeB`, `PatientJones`, `DrSmith`, `BillingDept`.

**Labels**: Pairs of `{confidentiality; integrity}` policies. Each policy is a set of **owner->reader** (confidentiality) or **owner<-writer** (integrity) specifications.

Example label: `{PracticeA -> PracticeA, DrSmith; PracticeB -> PracticeB}`

This means: PracticeA's data can be read by PracticeA and DrSmith; PracticeB's data can only be read by PracticeB. If these two data items are combined, the resulting label is the **join** (most restrictive combination):

`{PracticeA -> PracticeA, DrSmith; PracticeB -> PracticeB}` -- only someone who satisfies BOTH policies can read the combined data. In practice, nobody can, unless declassification occurs.

**Acts-for relation**: `q acts-for p` means principal q is trusted to act on behalf of p. Reflexive and transitive. Models groups, roles, delegation. Example: `DrSmith acts-for PracticeA` (Dr. Smith is authorized by Practice A).

**Declassification**: The controlled relaxation of a policy. Only the **owner** of a policy component can declassify it. If data has label `{PracticeA -> PracticeA}`, only PracticeA (or someone who acts-for PracticeA) can declassify to broaden the reader set. This is the critical operation for cross-practice data sharing.

**Policy composition**: When data from multiple sources is combined, labels are **joined** (least upper bound). This automatically produces the most restrictive combination. No information is lost, no policy is weakened. The join of incomparable labels produces a label that is more restrictive than either.

**The Jif Language**: A Java extension that implements the DLM with static (compile-time) type checking of information flow. Labels are part of the type system. The compiler verifies that no information flow violates any label policy.

```java
// Jif example
int{Alice->Bob} x = 42;          // x is owned by Alice, readable by Bob
int{Alice->Alice} y = x;         // ERROR: y is more restrictive, cannot assign less-restricted data
int{Alice->Bob,Chuck} z = x;     // OK: z is less restrictive, widening reader set
// To assign x to y, Alice must explicitly declassify:
y = declassify(x, {Alice->Alice});  // OK: Alice owns the policy, can restrict readers
```

### Key DIFC Systems

**HiStar** (Zeldovich et al., Stanford/MIT, OSDI 2006)
- DIFC operating system built from scratch around six kernel object types (segments, address spaces, threads, gates, containers, network devices).
- Every object has an immutable label. Threads have mutable labels that grow as they read sensitive data.
- **Gates**: The mechanism for declassification. A gate is an IPC entry point that can change a thread's label when invoked -- the code behind the gate is trusted to declassify correctly.
- Extremely small kernel TCB. Proved noninterference properties.

**Flume** (Krohn et al., MIT, SOSP 2007)
- DIFC as a user-level reference monitor on Linux.
- Key insight: DIFC can work at **process granularity** using standard OS abstractions (pipes, file descriptors).
- Processes have **secrecy labels** (S) and **integrity labels** (I), plus **capability sets** (O+ for adding tags, O- for removing tags).
- A process can send data to another only if the sender's labels are a subset of the receiver's labels.
- Formally proved noninterference using CSP formalism.
- Simpler than HiStar -- designed for retrofitting existing applications.

**Asbestos** (Efstathopoulos et al., MIT, SOSP 2005)
- Predecessor to HiStar and Flume. Introduced the concept of "event processes" that handle requests with temporary labels.
- Showed that DIFC could protect web applications by isolating user-specific data handling.

### Mapping to Dental PHI Pipeline

```
Practice A EHR  ──[label: {A->A}]──►  Ingestion Service
                                           │
Practice B EHR  ──[label: {B->B}]──►  Ingestion Service
                                           │
                                    ┌──────┴──────┐
                                    │  AI Pipeline  │
                                    │  label: join  │
                                    │  {A->A; B->B} │
                                    └──────┬──────┘
                                           │
                              ┌─────── declassify ───────┐
                              │  (requires A AND B auth)  │
                              └────────────┬─────────────┘
                                           │
                                    [De-identified]
                                    label: {public}
                                           │
                                    ┌──────┴──────┐
                                    │ Benchmarking │
                                    │   Output     │
                                    └─────────────┘
```

The join of `{A->A}` and `{B->B}` produces a label that **no one** can read unless both A and B authorize declassification. The AI pipeline carries this combined label. Only a trusted declassification gate (which performs de-identification) can lower the label to make the output sharable.

### Open Source Code

- **Jif**: https://www.cs.cornell.edu/jif/ (Java + IFC type system)
- **Flume**: Research prototype, described in SOSP 2007 paper
- **LIO (Labeled IO)**: Haskell library for DIFC -- https://hackage.haskell.org/package/lio
- **Laminar**: Combined OS + language DIFC (Roy et al., PLDI 2009)

---

## 3. Helen Nissenbaum's "Contextual Integrity"

### Core Concept

Contextual integrity (CI) is a philosophical framework that defines privacy not as secrecy or control, but as **appropriate flow of information** relative to the norms of the context in which it occurs. A privacy violation occurs when information flows in ways that violate the norms of the relevant context.

### The Five Parameters

Every information flow is described by five parameters. All five must be specified for a complete norm:

| Parameter | Definition | Dental Example |
|---|---|---|
| **Data Subject** | Whose information is it? | Patient Jones |
| **Sender** | Who is transmitting the information? | Practice A's EHR system |
| **Recipient** | Who receives the information? | AI benchmarking pipeline |
| **Information Type** | What category of information? | Treatment outcomes, clinical images, billing codes |
| **Transmission Principle** | Under what constraints does it flow? | With patient consent, for treatment purposes, de-identified for research |

### Context-Dependent Norms

The key insight: the **same** data flowing between the **same** parties can be appropriate or inappropriate depending on context.

**Clinical Context**: A dentist sharing a patient's full treatment history with a specialist for a referral. Norms: fiduciary duty, treatment purpose, professional obligation. This flow is appropriate.

**Billing Context**: Practice A sharing a patient's treatment codes with an insurance company. Norms: payment purpose, minimum necessary standard, contractual obligation. Appropriate, but with narrower information types than clinical context.

**Benchmarking Context**: Practice A sharing treatment outcomes with an AI platform that aggregates across practices. Norms: de-identified, aggregate purpose, no re-identification. Appropriate only if transmission principle includes de-identification.

**Violation Example**: The AI benchmarking platform sharing Practice A's individual patient outcomes with Practice B, even if both practices use the platform. This violates the norms of the benchmarking context (aggregate, not individual) even though both parties are "in the system."

### Transmission Principles as Policy

Transmission principles are the most operationally relevant parameter for engineering. They map directly to policy enforcement:

| Transmission Principle | Policy Implementation |
|---|---|
| With informed consent | Consent record check before data release |
| Confidentially | Encryption at rest and in transit, access logging |
| As required by law | Regulatory compliance checks (HIPAA, state law) |
| In aggregate/de-identified form | De-identification pipeline with k-anonymity or differential privacy |
| For treatment purposes only (TPO) | Purpose-binding labels, usage audit trails |
| Reciprocally | Both parties share, or neither does |
| With notice | Transparency logs, patient-facing audit trail |

### Formalization for Software

Nissenbaum and collaborators have formalized CI using temporal logic:

A **CI norm** can be expressed as: `N = (subject, sender, recipient, info_type, transmission_principle)`

A **flow** is: `F = (subject, sender, recipient, info_type, actual_transmission)`

A flow **conforms** to a norm if: for the given context, `F` matches some permitted `N` -- the actual transmission satisfies the transmission principle.

A **privacy violation** occurs when a flow happens that does not conform to any norm of the relevant context.

This maps naturally to a rule engine: define norms as rules, evaluate every data flow against the rule set, reject or flag non-conforming flows.

### Relevance to the Dental AI Platform

CI provides the **conceptual framework** that justifies why you need more than access control. Access control asks "can this user access this data?" CI asks "is this flow of data appropriate in this context?" The dental platform operates across multiple contexts simultaneously:

1. **Clinical context** (doctor-patient, referrals, treatment planning)
2. **Administrative context** (billing, scheduling, insurance)
3. **Research/benchmarking context** (aggregate analytics, quality metrics)
4. **AI training context** (model improvement, potentially most fraught)

Each context has different norms. The same patient's treatment data might flow appropriately in context 1, require minimization in context 2, require de-identification in context 3, and require explicit opt-in consent in context 4.

### Key Papers and Resources

- H. Nissenbaum, "Privacy as Contextual Integrity" (Washington Law Review, 2004)
- H. Nissenbaum, "Privacy in Context: Technology, Policy, and the Integrity of Social Life" (Stanford UP, 2010)
- H. Nissenbaum, "Contextual Integrity Up and Down the Data Food Chain" (Theoretical Inquiries in Law, 2017)
- A. Barth et al., "Privacy and Contextual Integrity: Framework and Applications" (IEEE S&P, 2006) -- formal logic model
- "Contextual Integrity through the Lens of Computer Science" (Cornell Tech)

---

## 4. Flume (MIT PDOS)

### Architecture

Flume is a DIFC system that operates as a **user-level reference monitor on Linux**. It intercepts system calls from confined processes and enforces information flow policies before allowing I/O operations.

### How It Works

1. **Tags**: Opaque tokens that represent security categories (e.g., "Practice A PHI", "Patient Jones data").
2. **Labels**: Sets of tags. Every process has:
   - **Secrecy label (S)**: The set of secrecy tags currently "tainting" the process.
   - **Integrity label (I)**: The set of integrity tags currently trusted by the process.
3. **Capabilities**: Each process has:
   - **O+ set**: Tags the process can add to its own label (i.e., it can voluntarily become more tainted).
   - **O- set**: Tags the process can remove from its own label (i.e., it can declassify).
4. **Flow rule**: Process P1 can send data to process P2 only if:
   - P1's secrecy label is a subset of P2's secrecy label (receiver is at least as tainted).
   - P2's integrity label is a subset of P1's integrity label (sender has at least as much integrity).

### Key Design Decisions

- **Process granularity**: Unlike Jif (variable-level) or HiStar (kernel object-level), Flume tracks labels per process. Coarser but simpler.
- **Standard OS abstractions**: Pipes, file descriptors, sockets all work -- Flume mediates at the system call boundary.
- **Untrusted + trusted process split**: Applications factor into untrusted workers (confined by DIFC) and small trusted declassifiers (which have O- capabilities to remove tags).
- **Retrofit-friendly**: Existing applications can run under Flume with minimal modification.

### Container/VM Applicability

Flume's architecture maps remarkably well to modern container-based systems:

| Flume Concept | Container Equivalent |
|---|---|
| Process with labels | Container with metadata labels |
| O+ / O- capability sets | Container runtime policies (seccomp, AppArmor) |
| Reference monitor | Service mesh sidecar (Envoy, Linkerd) |
| Flow rule check | Network policy (Kubernetes NetworkPolicy, Cilium) |
| Trusted declassifier | Dedicated de-identification microservice with elevated privileges |

A practical implementation could use:
- **Kubernetes labels/annotations** as security tags on pods.
- **Network policies** enforcing that Practice-A-labeled pods cannot communicate with Practice-B-labeled pods.
- **Service mesh mTLS** with certificate attributes carrying security labels.
- **Sidecar proxies** that check labels before forwarding requests -- acting as user-space reference monitors like Flume.

### Open Source / Code

- The original Flume is a research prototype (C/C++, Linux kernel modifications).
- No maintained open-source release, but the paper (SOSP 2007) contains the full design.
- **Practical alternative**: Implement Flume's concepts at the application layer using middleware (see Section 5: Aeolus) or at the infrastructure layer using service mesh + network policies.

### Key Papers

- M. Krohn et al., "Information Flow Control for Standard OS Abstractions" (SOSP 2007)
- M. Krohn & E. Tromer, "Noninterference for a Practical DIFC-Based Operating System" (IEEE S&P 2009)

---

## 5. Aeolus (MIT CSAIL PMG)

### What It Is

Aeolus is a **DIFC platform/middleware** built in Java that provides application-level information flow control without requiring a custom operating system. Developed by Barbara Liskov's group at MIT CSAIL (2010-2013).

### Core Abstractions

**Thread-Level Label Tracking**
- Every thread has a secrecy label and an integrity label.
- Labels are sets of tags. When a thread reads sensitive data, its label expands (becomes more tainted).
- All label manipulations are **explicit** -- unlike Flume/HiStar which auto-taint on read, Aeolus requires the programmer to manage labels. This prevents implicit tainting surprises but requires more discipline.

**Principal Hierarchy**
- Aeolus uses a standard principal-based authority model (like an LDAP directory or org chart).
- Principals have an acts-for relation. Authority flows through the hierarchy.
- The principal hierarchy matches how developers already reason about access control, making DIFC more approachable.

**Authority Closures**
- The mechanism for granting authority directly to **code** rather than to principals.
- A closure encapsulates a piece of code that runs with specific authority (e.g., the authority to declassify a particular tag).
- Analogous to a "trusted declassifier process" in Flume, but at method granularity.
- The closure is a first-class object that can be passed around but can only be invoked by the Aeolus runtime with proper authority checks.

**Compound Tags**
- Allow grouping related simple tags into a single composite tag.
- Example: Instead of separate tags for `PracticeA_Clinical`, `PracticeA_Billing`, `PracticeA_Images`, you create a compound tag `PracticeA` with sub-tags. Policies on the compound tag apply to all sub-tags.

**Boxes**
- A mechanism to avoid premature tainting. A box holds labeled data without the thread reading it (and thus without the thread becoming tainted).
- The thread can inspect the box's label before deciding whether to open it.
- Critical for pipeline architectures: a routing service can forward labeled data to the appropriate handler without itself becoming tainted by every practice's data.

**Shared Volatile State**
- Controlled inter-thread communication with label checks.
- Every shared object has labels. A thread can read/write only if its labels are compatible.
- The **only** way threads communicate: shared state, RPCs, and the Aeolus file system. All are mediated.

### How It Compares to OS-Level DIFC

| Aspect | HiStar/Flume (OS-level) | Aeolus (Middleware) |
|---|---|---|
| Granularity | Process / kernel object | Thread / Java object |
| TCB | Custom kernel | JVM + Aeolus runtime |
| Deployment | Requires custom OS | Runs on standard Java |
| Label management | Implicit (auto-taint on read) | Explicit (programmer manages) |
| Declassification | Gates (HiStar) / O- sets (Flume) | Authority closures |
| Performance overhead | Low (kernel-level) | Moderate (JVM interposition) |
| Retrofit-ability | Hard (need custom OS) | Moderate (need Aeolus API) |

### Effect-TS Middleware Analog

Aeolus's architecture maps remarkably well to an Effect-TS service layer:

```typescript
// Conceptual mapping (not runnable code)

// Tags as branded types
type SecurityTag = Brand.Brand<string, "SecurityTag">
const PracticeA_PHI = SecurityTag("practice-a-phi")
const PracticeB_PHI = SecurityTag("practice-b-phi")

// Labels as immutable sets of tags
interface Label {
  readonly secrecy: ReadonlySet<SecurityTag>
  readonly integrity: ReadonlySet<SecurityTag>
}

// Every Effect carries a label in its context
interface LabeledEffect<A, E> extends Effect.Effect<A, E> {
  readonly label: Label
}

// Authority closure: a function that can only be invoked with proper authority
interface AuthorityClosure<A> {
  readonly requiredAuthority: ReadonlySet<SecurityTag>
  readonly execute: () => Effect.Effect<A, SecurityError>
}

// Box: holds labeled data without tainting the reader
interface Box<A> {
  readonly label: Label
  readonly open: () => Effect.Effect<A, LabelViolation>
}

// Flow check middleware
const checkFlow = (source: Label, dest: Label): boolean =>
  isSubset(source.secrecy, dest.secrecy) &&
  isSubset(dest.integrity, source.integrity)
```

### Associated Systems

- **IFDB**: DIFC for databases, built on Aeolus. Modified PostgreSQL to track labels on rows and columns. Threads can only query rows whose labels are compatible with the thread's labels. Supports "declassifying views" -- SQL views that run with authority to declassify specific tags, producing less-sensitive result sets.
- **Aeolus File System**: A distributed file system with per-file labels and flow checking.

### Key Papers

- W. Cheng et al., "Abstractions for Usable Information Flow Control in Aeolus" (USENIX ATC 2012)
- B. Liskov, "Aeolus Reference Manual" (MIT-CSAIL-TR-2012-030)
- D. Schultz et al., "IFDB: Decentralized Information Flow Control for Databases" (EuroSys 2013)

---

## 6. Policy-as-Code

### The Landscape

Policy-as-code systems externalize authorization logic from application code into declarative policy languages evaluated by dedicated engines. Three dominant approaches:

### Open Policy Agent (OPA) / Rego

**What it is**: A general-purpose policy engine. Policies are written in Rego (a Datalog/Prolog derivative). OPA evaluates policies against structured input (JSON) and returns decisions.

**Strengths**:
- General-purpose: works for API authorization, Kubernetes admission control, Terraform validation, data filtering.
- **Partial evaluation**: Can partially evaluate a policy against known inputs and produce residual queries (e.g., SQL WHERE clauses) for data-layer enforcement. This is powerful for data filtering at the database level.
- Mature ecosystem: Envoy plugin, Kubernetes admission controller, Terraform integration.
- Large community (though Apple's acquisition of key maintainers in mid-2025 has introduced uncertainty).

**Rego example for dental PHI**:
```rego
package dental.phi

# Only allow access if requester's practice matches data's practice
allow {
    input.requester.practice_id == input.data.practice_id
    input.requester.role in {"dentist", "hygienist", "admin"}
}

# Allow cross-practice access only for de-identified data
allow {
    input.requester.practice_id != input.data.practice_id
    input.data.de_identified == true
    input.requester.role in {"analyst", "admin"}
}

# Deny by default (OPA is deny-by-default when no allow rule matches)
```

**Limitations for IFC**: OPA evaluates **point-in-time decisions** -- "Is this request allowed?" It does not track data flow through computation. Once OPA says "allow," the data is in the application and OPA has no further control. OPA enforces **access control**, not **information flow control**.

### Cedar (AWS)

**What it is**: A purpose-built authorization policy language from AWS. Used in Amazon Verified Permissions and IAM Identity Center.

**Strengths**:
- **Extremely fast**: 42-60x faster than Rego in benchmarks. Sub-millisecond evaluation.
- **Safe by design**: Deterministic, no side effects, no external data fetches during evaluation. Formally verified using Lean 4.
- **Readable syntax**: Domain-specific for authorization. Easy to audit.
- **Verification tools**: Open-source analysis tools can prove properties about policy sets (e.g., "no policy ever grants access to PHI without role=dentist").
- **Principal/Action/Resource/Context model**: Natural fit for healthcare authorization.

**Cedar example for dental PHI**:
```cedar
// Dentists can view patient records in their own practice
permit (
    principal in Role::"Dentist",
    action == Action::"ViewRecord",
    resource in PracticeRecords::"PracticeA"
) when {
    principal.practice_id == resource.practice_id
};

// AI pipeline can read PHI only when in clinical-analysis context
permit (
    principal == Service::"AIPipeline",
    action == Action::"ReadPHI",
    resource
) when {
    context.purpose == "clinical_analysis" &&
    context.has_baa == true &&
    context.de_identification_level >= 2
};

// Forbid cross-practice identified data access
forbid (
    principal,
    action == Action::"ReadPHI",
    resource
) when {
    principal.practice_id != resource.practice_id &&
    resource.de_identified == false
};
```

**Limitations for IFC**: Same as OPA -- Cedar is an authorization decision engine, not an information flow tracker. It cannot track what happens to data after the decision is made.

### Google Zanzibar / SpiceDB

**What it is**: Relationship-based access control (ReBAC). Authorization is determined by the existence of relationship chains between subjects and objects.

**SpiceDB** is the leading open-source implementation of Zanzibar's concepts.

**Core model**: Everything is a **relationship tuple**: `(object, relation, subject)`. For example:
- `(document:patient-jones-chart, viewer, user:dr-smith)`
- `(practice:practiceA, member, user:dr-smith)`
- `(document:patient-jones-chart, parent, practice:practiceA)`

Permissions are computed by traversing relationship chains:

```
definition practice {
    relation member: user
    relation admin: user
    permission manage = admin
}

definition patient_record {
    relation practice: practice
    relation treating_provider: user
    permission view = treating_provider + practice->member
    permission edit = treating_provider
    permission share_cross_practice = practice->admin
}
```

**Strengths**:
- Natural for modeling organizational hierarchies (practices, departments, roles).
- Scales to billions of relationships (Google uses Zanzibar for Drive, YouTube, Cloud IAM).
- **Consistent**: Supports "Zookies" (consistency tokens) to prevent TOCTOU attacks.
- SpiceDB supports PostgreSQL, CockroachDB, Spanner backends.

**Limitations for IFC**: Like OPA and Cedar, Zanzibar/SpiceDB is an access control system. It answers "can X access Y?" not "where has Y's data flowed?"

### Comparison for Dental PHI

| Capability | OPA/Rego | Cedar | Zanzibar/SpiceDB | IFC/DIFC |
|---|---|---|---|---|
| Access control decisions | Yes | Yes | Yes | Implicit |
| Data flow tracking | No | No | No | **Yes** |
| Policy composition | Via Rego logic | Via policy sets | Via relationship graphs | Via label lattice |
| Cross-practice policies | Manual rules | Manual rules | Relationship modeling | **Automatic via label join** |
| De-identification enforcement | External check | External check | External check | **Built into declassification** |
| Audit trail | Decision logs | Decision logs | Relationship changes | **Label history** |
| Performance | Moderate | Fast | Fast | Depends on implementation |
| Maturity | Production | Production | Production | Research + niche production |

**The synthesis**: Policy-as-code (Cedar or OPA) handles the **access control** layer -- "should this request be allowed?" DIFC handles the **data flow** layer -- "is this data allowed to reach this computation?" You need both. Cedar/OPA gates the door; DIFC tracks what happens after you walk through it.

### Open Source

- **OPA**: https://github.com/open-policy-agent/opa (Go, Apache 2.0)
- **Cedar**: https://github.com/cedar-policy/cedar (Rust, Apache 2.0)
- **SpiceDB**: https://github.com/authzed/spicedb (Go, Apache 2.0)
- **OpenFGA**: https://github.com/openfga/openfga (Go, Apache 2.0) -- another Zanzibar implementation, backed by Okta/Auth0

---

## 7. Capability-Based Security

### Core Concept

In capability-based security, a **capability** is an unforgeable reference to an object that simultaneously:
1. **Designates** the object (identifies it).
2. **Authorizes** the holder to perform operations on it.

No capability = no access. There is no ambient authority. You cannot access anything unless someone explicitly gave you a reference to it. This is the **Principle of Least Authority (POLA)** made structural.

Contrast with ACL-based security:
- **ACL**: "Object X has a list of who can access it." Authority resides with the object.
- **Capability**: "Subject Y holds a token that grants access to X." Authority resides with the holder.

### Object Capabilities (OCaps)

In object-oriented languages, object references naturally serve as capabilities -- if you have a reference to an object, you can call its methods. The problem is that mainstream languages provide **ambient authority** (global variables, import statements, file system access) that violates the capability model.

**OCap discipline** restricts the language to eliminate ambient authority:
- No global mutable state.
- No unrestricted I/O.
- No `eval` or `Function` constructor.
- Authority is only obtained by: (a) creation, (b) endowment (constructor injection), (c) introduction (someone passes you a reference).

### The E Programming Language

Designed by Mark Miller (2000s). The first language built from the ground up for capability security in distributed systems.

Key innovations:
- Object references = capabilities.
- **Eventual sends**: `obj <- message()` sends a message asynchronously and returns a **promise**. This enables secure distributed programming without blocking.
- **Promise pipelining**: You can send messages to a promise before it resolves. The messages are queued and forwarded when the promise resolves. This eliminates round-trip latency in distributed capability systems.
- **Vats**: Isolated execution contexts (like actors/processes). Each vat is single-threaded. Communication between vats is only via eventual sends.

### Agoric / Hardened JavaScript (SES)

Mark Miller (E language creator) brought capability security to JavaScript through:

**SES (Secure ECMAScript) / Hardened JS**:
- `lockdown()` freezes all JavaScript intrinsics (Object, Array, Promise, etc.) to prevent prototype pollution.
- `harden(obj)` deeply freezes an object, making it a safe capability to pass around.
- `Compartment` creates isolated evaluation contexts with no ambient authority -- no `fetch`, no `fs`, no `process`. Only what you explicitly endow.

```javascript
import { lockdown } from 'ses'
lockdown()

// Create an isolated compartment with minimal authority
const compartment = new Compartment({
  globals: {
    // Only give it what it needs -- nothing else
    processRecord: harden((record) => {
      // This code can process the record but cannot:
      // - Access the file system
      // - Make network requests
      // - Read environment variables
      // - Access any other data
      return { score: record.treatment_score * 0.8 }
    })
  }
})
```

**Endo**: Agoric's distributed secure JavaScript platform. Uses SES compartments for isolation, with capability-based messaging between compartments.

**Production use**: Agoric blockchain smart contracts, MetaMask plugin sandboxing, supply chain security for npm packages.

### Cap'n Proto

Created by Kenton Varda (ex-Google, created Protocol Buffers v2). Cap'n Proto is both a serialization format and a capability-based RPC system.

**Capability-based RPC**:
- Interface references are first-class types. When you call a method that returns an interface, you get a capability to call that interface.
- Capabilities are scoped to connections -- each host assigns connection-specific IDs, preventing forgery.
- Capabilities can be passed as method parameters, enabling secure delegation.

**Promise pipelining** (from E language):
- When you call `foo()` which returns an interface, and then call `bar()` on that interface, Cap'n Proto sends both calls together without waiting for `foo()` to return.
- This eliminates the "chatty protocol" problem of traditional RPC.

**Levels of capability support**:
- Level 1: Basic capabilities + pipelining.
- Level 2: Persistent capabilities (save a capability reference, restore it later on a new connection).
- Level 3: Three-party handoff (A can introduce B to C by passing C's capability to B).
- Level 4: Reference equality (verify two capabilities refer to the same object).

**Cap'n Web**: JavaScript implementation for browser-to-server and server-to-server RPC. Developed at Cloudflare for Workers.

### Mapping to Dental PHI Platform

Capability-based security is deeply complementary to DIFC:

| Capability Concept | Dental Platform Mapping |
|---|---|
| Capability = reference + authority | A practice's API token is a capability granting access to that practice's data |
| No ambient authority | AI pipeline stages receive only the data they need, nothing more |
| Capability attenuation | A "read-only, de-identified" capability derived from a "full-access" capability |
| Promise pipelining | Pipeline stages can be chained without round-trip latency |
| Compartments (SES) | Each practice's data processing runs in an isolated compartment |
| Endowment | Pipeline stages are endowed only with capabilities for their input/output |

**Practical architecture**:

```
Practice A EHR
    │
    └── issues capability: ReadPracticeA_PHI(scope: clinical)
            │
            ▼
    Ingestion Service (compartment)
        - Endowed with: ReadPracticeA_PHI, WriteToNormalized
        - NOT endowed with: ReadPracticeB, WriteToExternal, NetworkAccess
            │
            └── attenuates to: ReadNormalized_DeIdentified
                    │
                    ▼
            AI Analysis Service (compartment)
                - Endowed with: ReadNormalized_DeIdentified, WriteAnalysisResult
                - NOT endowed with: ReadRaw_PHI, any practice-specific capability
                    │
                    └── produces: AnalysisResult (no PHI capability needed to read)
                            │
                            ▼
                    Benchmarking Dashboard
```

Each stage has **exactly** the authority it needs. A compromised AI Analysis Service cannot access raw PHI because it was never given a capability for it. This is defense-in-depth that survives even if one component is fully compromised.

### Open Source

- **Endo/SES**: https://github.com/endojs/endo (JavaScript, Apache 2.0)
- **Cap'n Proto**: https://github.com/capnproto/capnproto (C++, MIT)
- **Cap'n Web**: Cloudflare's JS implementation
- **Caja** (archived): Google's capability-secure JavaScript subset
- **awesome-ocap**: https://github.com/dckc/awesome-ocap -- curated list of capability-based security resources

---

## Synthesis: Architecture for Dental PHI Across Practice Boundaries

### The Three Layers

Based on this research, a robust data-centric policy enforcement system for dental PHI needs three complementary layers:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Contextual Integrity (Conceptual Framework)   │
│  "Is this flow appropriate in this context?"            │
│  Defines WHAT norms exist for each context              │
│  (clinical, billing, benchmarking, AI training)         │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Access Control (Policy-as-Code)               │
│  "Is this request authorized?"                          │
│  Cedar/OPA: gates entry to resources                    │
│  SpiceDB: models organizational relationships           │
│  Enforces norms at the API boundary                     │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Information Flow Control (DIFC + Capabilities)│
│  "Where has this data flowed? Where CAN it flow?"       │
│  Labels track data through computation                  │
│  Capabilities limit what each component can access      │
│  Enforces norms INSIDE the pipeline                     │
└─────────────────────────────────────────────────────────┘
```

### Practical Implementation Path for Effect-TS

Given the Aiden/Maslow tech stack (Effect-TS, TypeScript, Node.js), here is a pragmatic implementation path:

**Phase 1: Policy-as-Code (Cedar)**
- Deploy Cedar as the authorization engine (Rust core, Node.js bindings available via `@cedar-policy/cedar-wasm`).
- Define Cedar policies for practice-scoped access, role-based permissions, cross-practice rules.
- Integrate with the Effect-TS service layer as middleware that gates every data access.

**Phase 2: Label-Based Data Flow Tracking (Aeolus-inspired)**
- Implement labels as branded types in the Effect-TS type system.
- Every data object carries a `Label` (set of security tags).
- Service layer middleware checks label compatibility before passing data between services.
- Implement "boxes" -- lazy-evaluated containers that carry labels without tainting the handler.
- Implement "authority closures" -- Effect-TS functions that run with specific declassification authority.

**Phase 3: Capability Isolation (SES/Compartments)**
- Use SES `Compartment` to isolate AI pipeline stages.
- Each stage receives only the capabilities it needs (endowment pattern).
- Capability attenuation for de-identified views of data.
- Evaluate Cap'n Proto for inter-service RPC with capability passing.

**Phase 4: Contextual Integrity Audit**
- Define information flow norms for each context (clinical, billing, benchmarking, AI training).
- Every data flow is logged with all five CI parameters.
- Audit system flags flows that violate defined norms.
- Patient-facing transparency log showing what data flowed where and why.

### What This Buys You

1. **Regulatory confidence**: HIPAA requires "minimum necessary" standard. DIFC enforces it structurally, not just procedurally.
2. **Practice trust**: Competing practices can share a platform knowing their data is cryptographically and structurally isolated.
3. **AI safety**: The AI pipeline cannot access more data than it needs. A compromised model cannot exfiltrate cross-practice PHI.
4. **Audit trail**: Every data flow, every label change, every declassification is logged with all five CI parameters.
5. **Composability**: When a new practice joins, their data gets new tags. Existing policies compose automatically via the label lattice.

---

## References

### IFC Foundations
- [Bell-LaPadula model (Wikipedia)](https://en.wikipedia.org/wiki/Bell%E2%80%93LaPadula_model)
- [Lattice-Based Access Control Models](https://www.cs.kent.edu/~rothstei/spring_13/papers/Lattice.pdf)
- [Information Security Models: Biba, Bell-LaPadula & More](https://destcert.com/resources/information-security-models/)
- [Enhanced Bell-LaPadula with Blockchain for Healthcare (Springer)](https://link.springer.com/article/10.1007/s12652-020-02346-8)

### DIFC
- [Myers & Liskov, "A Decentralized Model for Information Flow Control" (SOSP 1997)](https://dl.acm.org/doi/10.1145/268998.266669)
- [Myers & Liskov, "Protecting Privacy using the Decentralized Label Model" (TOSEM 2000)](https://dl.acm.org/doi/10.1145/363516.363526)
- [Decentralized Label Model Reference (Jif docs)](https://www.cs.cornell.edu/jif/doc/jif-3.3.0/dlm.html)
- [DLM Overview (PLS Lab)](https://www.pls-lab.org/en/Decentralized_label_model)
- [Flume: Information Flow Control for Standard OS Abstractions (SOSP 2007)](https://pdos.csail.mit.edu/papers/flume-sosp07.pdf)
- [HiStar: Making Information Flow Explicit (OSDI 2006)](http://www.scs.stanford.edu/~nickolai/papers/zeldovich-histar.pdf)
- [Noninterference for Flume (IEEE S&P 2009)](https://cs-people.bu.edu/tromer/papers/flumecsp.pdf)
- [DIFCS: Secure Cloud Data Sharing Based on DIFC (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0167404822000761)

### Contextual Integrity
- [Nissenbaum, "Privacy as Contextual Integrity" (Washington Law Review 2004)](https://digitalcommons.law.uw.edu/wlr/vol79/iss1/10/)
- [Nissenbaum, "Contextual Integrity Up and Down the Data Food Chain"](https://nissenbaum.tech.cornell.edu/papers/Contextual%20Integrity%20Up%20and%20Down.pdf)
- [Barth et al., "Privacy and Contextual Integrity: Framework and Applications"](https://nissenbaum.tech.cornell.edu/papers/Privacy%20and%20Contextual%20Integrity%20-%20Frameworks%20and%20Applications.pdf)
- [Contextual Integrity through the Lens of Computer Science](https://nissenbaum.tech.cornell.edu/papers/Contextual%20Integrity%20through%20the%20Lens%20of%20CS.pdf)
- [Contextual Integrity (Wikipedia)](https://en.wikipedia.org/wiki/Contextual_integrity)

### Aeolus & IFDB
- [Cheng et al., "Abstractions for Usable Information Flow Control in Aeolus" (USENIX ATC 2012)](https://www.usenix.org/conference/atc12/technical-sessions/presentation/cheng)
- [Liskov, "Aeolus Reference Manual" (MIT-CSAIL-TR-2012-030)](https://dspace.mit.edu/handle/1721.1/73017)
- [Schultz et al., "IFDB: Decentralized Information Flow Control for Databases" (EuroSys 2013)](http://pmg.csail.mit.edu/papers/ifdb.pdf)
- [Aeolus Project Page](http://pmg.csail.mit.edu/aeolus/)

### Policy-as-Code
- [OPA vs Cedar vs Zanzibar: 2025 Policy Engine Guide (Oso)](https://www.osohq.com/learn/opa-vs-cedar-vs-zanzibar)
- [Policy Engines Comparison (Permit.io)](https://www.permit.io/blog/policy-engines)
- [Cedar Policy Language Reference](https://docs.cedarpolicy.com/)
- [Cedar: Expressive, Fast, Safe Authorization (ACM 2024)](https://dl.acm.org/doi/10.1145/3649835)
- [Cedar GitHub](https://github.com/cedar-policy/cedar)
- [OPA Documentation](https://www.openpolicyagent.org/docs/latest/)
- [OPA GitHub](https://github.com/open-policy-agent/opa)
- [SpiceDB GitHub](https://github.com/authzed/spicedb)
- [SpiceDB / Zanzibar Overview (Authzed)](https://authzed.com/docs/spicedb/concepts/zanzibar)
- [SpiceDB Schema Language Reference](https://authzed.com/docs/spicedb/concepts/schema)
- [Security Benchmarking Policy Engines (Teleport)](https://goteleport.com/blog/benchmarking-policy-languages/)
- [OPA Partial Evaluation for Data Filtering](https://jacky-jiang.medium.com/policy-based-data-filtering-solution-using-partial-evaluation-c8736bd089e0)

### Capability-Based Security
- [Hardened JavaScript (Agoric docs)](https://docs.agoric.com/guides/js-programming/hardened-js)
- [Endo/SES GitHub](https://github.com/endojs/endo)
- [SES Guide](https://github.com/endojs/endo/blob/master/packages/ses/docs/guide.md)
- [Cap'n Proto RPC Protocol](https://capnproto.org/rpc.html)
- [Cap'n Proto GitHub](https://github.com/capnproto/capnproto)
- [Cap'n Web (Cloudflare)](https://blog.cloudflare.com/capnweb-javascript-rpc-library/)
- [Awesome Object Capabilities](https://github.com/dckc/awesome-ocap)
- [Capability-Based Security (Wikipedia)](https://en.wikipedia.org/wiki/Capability-based_security)
- [Context-Aware Capability-Based Access Control for IoMT](https://www.researchgate.net/publication/318146399)

### Taint Tracking / Runtime IFC
- [Augur: Taint Analysis for Node.js](https://github.com/nuprl/augur)
- [TaintFlow: Dynamic IFC for JavaScript](https://github.com/Invizory/taintflow)
- [Static Taint Analysis via TypeScript Type-checking (SJSU)](https://scholarworks.sjsu.edu/cgi/viewcontent.cgi?article=2262&context=etd_projects)
- [CodeQL Data Flow Analysis for JavaScript/TypeScript](https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/)

### Healthcare Data Security
- [HIPAA for Dental Offices: Full Guide (2025)](https://www.keragon.com/hipaa/hipaa-explained/hipaa-for-dental-offices)
- [Healthcare Data Governance Framework (arXiv)](https://arxiv.org/html/2403.17648v1)
- [AI-Driven PHI De-Identification (Medium)](https://medium.com/@sajeevysingh/ai-driven-anonymity-phi-masking-de-identification-with-machine-learning-b5c36b0c69a7)
- [Privacy-Preserving ML: Minimizing PII & PHI (Alation)](https://www.alation.com/blog/privacy-preserving-ml-minimizing-pii-phi/)
- [LLMs with Sensitive Data: Privacy Guide (Sigma AI)](https://sigma.ai/llm-privacy-security-phi-pii-best-practices/)
