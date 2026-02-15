# Privacy Type Systems & Static Information Flow Analysis

## Research Question

Can computation graphs be type-checked against data policies before execution? Could this work in a TypeScript/Effect-TS codebase?

---

## 1. Jif (Java Information Flow)

**Origin:** Cornell University, supervised by Andrew Myers. First described in the 1999 paper "Practical Mostly-Static Information Flow Control."

### Concept

Jif extends Java's type system with **security labels** based on the **Decentralized Label Model (DLM)**. Every variable's type includes a label declaring which principals own the data and who may read it. The compiler performs static analysis to verify that all information flows respect these labels before producing standard Java bytecode.

### What a Jif Program Looks Like

```java
// Label syntax: {owner: reader1, reader2}
int{Alice: Bob} x = 42;           // Alice owns, Bob can read
int{Alice: Bob, Chuck} y = 10;    // Alice owns, Bob and Chuck can read

y = x;  // REJECTED: would expose x to Chuck, violating Alice's policy
x = y;  // OK: doesn't widen access beyond what Alice already permits

// Parameterized secure collection
public class Vector[label L] extends AbstractList[L] {
    private int{L} length;
    private Object{L}[]{L} elements;
}

// Method with information flow annotation
public Object elementAt(int i):{L; i}
    throws (IndexOutOfBoundsException) {
    return elements[i];
}

// Controlled declassification (escape hatch)
declassify({y}) y = 1;
```

Key features:
- **Principals and delegation:** `p` may delegate authority to `q`, meaning `q` acts for `p`
- **Reader policies:** `{Alice -> Bob}` means Alice permits Bob to read
- **Integrity policies:** `{Alice <- Bob}` means Bob may influence Alice's data
- **Dynamic labels:** runtime label comparisons for conditional security
- **Robust declassification:** controlled downgrading with authority proofs

### Maintenance Status

The [apl-cornell/jif](https://github.com/apl-cornell/jif) repository was last updated May 2025. Current version is 3.5.0. It compiles to Java and requires the Jif runtime library. The project also spawned [Fabric](https://github.com/apl-cornell/fabric), a distributed programming language with information flow types.

### Production Readiness

**Research-grade.** Jif has been used in several academic case studies (secure email, auction systems, medical records) but has never achieved mainstream adoption. It requires a custom compiler, and the learning curve is steep. However, the DLM and the label algebra are the most mature and well-studied IFC type system in existence.

### Key Papers/Repos
- [Jif: Language-based Information-flow Security in Java](https://arxiv.org/abs/1412.8639) (2014, comprehensive overview)
- [Protecting Privacy Using the Decentralized Label Model](https://dl.acm.org/doi/pdf/10.1145/363516.363526) (Myers & Liskov, 2000 -- foundational)
- [GitHub: apl-cornell/jif](https://github.com/apl-cornell/jif)
- [Jif Documentation](https://www.cs.cornell.edu/jif/)

### Could It Port to TypeScript?

The DLM concepts are language-agnostic. The label algebra (join, meet, delegation) could be encoded as TypeScript types. The challenge is that Jif relies on a custom compiler pass -- TypeScript's compiler is not extensible in the same way. However, the *ideas* (label annotations, flow checking, declassification gates) absolutely port. The R channel in Effect-TS is a natural place to encode these labels (see Section 7).

---

## 2. FlowCaml

**Origin:** Vincent Simonet, PhD work at INRIA Rocquencourt under Francois Pottier. Announced 2003.

### Concept

FlowCaml extends OCaml with **security-level annotations on types**, drawn from a user-definable lattice. The critical innovation: **full type inference**. You write normal OCaml code, define a security lattice, and FlowCaml infers the security levels of every expression and verifies that all flows are legal -- **without requiring annotations in the source code**.

### What FlowCaml Looks Like

```ocaml
(* Define the security lattice *)
flow !low < !high

(* Function types carry five components: *)
(* arg -{ pc | exceptions | identity }-> result *)
(* The program counter (pc) tracks implicit flows *)

(* Type with security levels *)
(* int#'a means an integer at security level 'a *)
(* FlowCaml infers: this function has type *)
(* int#!low -> int#!high -> int#!high *)
let add_secret public secret = public + secret

(* This would be rejected: *)
(* Trying to return high-security data where low is expected *)
let leak secret = (secret : int#!low)  (* TYPE ERROR *)
```

Security lattice definitions:
```
level MyLevel greater than !alice, !bob less than !charlie
```

Type schemes with constraints:
```
'a -> 'b with !alice < 'a and 'a < !bob
```

### How It Compares to Jif

| Aspect | Jif | FlowCaml |
|--------|-----|----------|
| Base language | Java (imperative, OOP) | OCaml (functional, ML) |
| Annotations required | Yes, explicit labels on types | No, full inference |
| Label model | Decentralized Label Model (principals) | Security lattice (partial order) |
| Declassification | Yes, with authority | Not built-in |
| Dynamic labels | Yes | No (fully static) |
| Maintained | Yes (2025) | No (last release ~2003) |

### Production Readiness

**Abandoned research prototype.** FlowCaml has not been maintained since the mid-2000s. Its academic contribution was proving that full type inference for information flow is possible in a real ML-family language. The implementation is entirely in OCaml.

### Key Papers/Repos
- [Flow Caml in a Nutshell](http://cristal.inria.fr/~simonet/publis/simonet-flowcaml-nutshell.pdf) (Simonet, APPSEM 2003)
- [Flow Caml Manual](http://cristal.inria.fr/~simonet/soft/flowcaml/flowcaml-manual.pdf)
- [FlowCaml Website](https://www.normalesup.org/~simonet/soft/flowcaml/)
- [GitHub mirror: pmundkur/flowcaml](https://github.com/pmundkur/flowcaml)

### Could It Port to TypeScript?

The inference algorithm is specific to ML's Hindley-Milner type system, which TypeScript does not use. However, the lattice-based approach to security levels is simpler than Jif's DLM and could be manually encoded using TypeScript's branded/phantom types. The key insight -- that security levels form a lattice and information can only flow "upward" -- is directly applicable.

---

## 3. Haskell Approaches

Haskell's type system is uniquely suited to IFC because monads already encapsulate computational effects. Three major libraries exist:

### 3a. LIO (Labeled IO)

**Origin:** Deian Stefan et al., Stanford/UCSD. Published at Haskell Symposium 2011.

LIO is a **dynamic** IFC library. It replaces the `IO` monad with an `LIO` monad that tracks a *current label* at runtime. Labels form a lattice, and the monad prevents information from flowing to less-restricted destinations.

```haskell
-- The LIO monad tracks current label + clearance
type LIO l a  -- l is the label type, a is the result

-- Labeled values
data Labeled l a  -- a value 'a' protected by label 'l'

-- Core operations
label   :: Label l => l -> a -> LIO l (Labeled l a)  -- wrap with label
unlabel :: Label l => Labeled l a -> LIO l a          -- unwrap (raises current label)

-- Label lattice constraint
canFlowTo :: l -> l -> Bool  -- partial order check
```

Key properties:
- **Current label** rises monotonically as you observe more data
- **Clearance** provides an upper bound (discretionary access control)
- **LabelFault** exceptions on information flow violations
- Used in production at [Hails](http://hails.scs.stanford.edu/), a web framework

### 3b. MAC (Mandatory Access Control Monad)

**Origin:** Alejandro Russo, Chalmers University. Published at Haskell Symposium 2015.

MAC is a **static** IFC library that uses Haskell's type system to enforce noninterference at compile time. Unlike LIO's runtime checks, MAC catches violations during type-checking.

```haskell
-- The MAC monad, parameterized by security label
newtype MAC l a = MkMAC (IO a)

-- Labeled resources
newtype Res l a = MkRes { unRes :: a }

-- Running a secure computation
runMAC :: MAC l a -> IO a

-- Trusted computing base escape hatch
ioTCB :: IO a -> MAC l a
```

MAC is simpler than LIO: it is purely monadic (no arrows), and the label `l` is a phantom type parameter that exists only at the type level. The Haskell compiler ensures that a `MAC High a` computation cannot leak into a `MAC Low a` context.

### 3c. FLAME (Flow-Limited Authorization)

**Origin:** Owen Arden, Cornell (PhD under Andrew Myers). Dissertation 2017.

FLAME is a **GHC compiler plugin** that enforces the Flow-Limited Authorization Calculus (FLAC) at the type level. It combines information flow control with authorization -- principals can dynamically grant and revoke permissions, and the type system tracks these.

```haskell
-- FLAME monads encode flow restrictions
-- Principals form a hierarchy
-- Type-level constraints enforce authorization

-- Code runs in a FLAME monad parameterized by principal
-- The plugin verifies that all flows respect the authorization lattice
```

Key properties:
- **Noninterference + robust declassification** verified at compile time
- **Dynamic authorization** -- principals grant/revoke at runtime, types track statically
- **GHC plugin** -- does not require a custom compiler
- Builds on Jif's DLM but adds authorization as a first-class concept

### Production Readiness

- **LIO:** Most production-ready. Used in Hails, actively maintained on [Hackage](https://hackage.haskell.org/package/lio). Dynamic checks add runtime overhead.
- **MAC:** Research library on [Hackage](https://hackage.haskell.org/package/mac). Static guarantees, no runtime overhead, but less flexible.
- **FLAME:** Research prototype. GHC plugin approach is clever but not widely adopted.

### Key Papers/Repos
- [Flexible Dynamic Information Flow Control in Haskell](https://www.scs.stanford.edu/~dm/home/papers/stefan:lio.pdf) (Stefan et al., 2011)
- [A Library for Light-Weight Information-Flow Security in Haskell](https://www.cse.chalmers.se/~russo/publications_files/haskell22Ext-russo.pdf) (Russo, 2015)
- [FLAME project page](https://owenarden.github.io/home/projects/FLA)
- [Flow-Limited Authorization dissertation](https://www.cs.cornell.edu/andru/papers/FLA_OwenArden.pdf) (Arden, 2017)

### Could Effect-TS Support Similar Patterns?

**Yes, and this is the most promising analogy.** Effect-TS's `Effect<A, E, R>` is structurally similar to Haskell's monadic IFC:

| Haskell IFC | Effect-TS |
|-------------|-----------|
| `MAC l a` | `Effect<A, E, R>` |
| Label `l` (phantom type) | Requirements `R` (phantom type) |
| `runMAC` (provide IO) | `Effect.runPromise` (provide layers) |
| `ioTCB` (escape hatch) | `Effect.runSync` / unsafe coercion |
| Label lattice ordering | Service dependency graph |

The R channel already uses phantom types to track requirements. Encoding security labels as additional phantom type requirements is architecturally natural.

---

## 4. Rust Approaches

### 4a. Cocoon (2024)

**Origin:** Andrew Hirsch & Ethan Cecchetti, published at OOPSLA 2024 (SPLASH).

Cocoon is the first static IFC library for a mainstream imperative language that uses only the **unmodified Rust compiler**. No custom toolchain required.

### How It Works

```rust
// Security labels are zero-sized types
struct Label_A;
struct Label_B;
struct Label_AB;  // join of A and B

// Secret<T, L> wraps values with a security label
// Zero runtime cost -- same representation as T
let alice_cal: HashMap<String, Secret<bool, lat::A>> = /* ... */;
let mut count = secret_block!(lat::AB { wrap_secret(0) });

// Secret blocks provide lexically-scoped access
for (day, available) in alice_cal {
    secret_block!(lat::AB {
        if unwrap_secret(available) &&
           *unwrap_secret_ref(&bob_cal[&day]) {
            *unwrap_secret_mut_ref(&mut count) += 1;
        }
    });
}

// Explicit declassification
println!("Overlapping days: {}", count.declassify());
```

Key mechanisms:
- **`Secret<T, L>`** -- zero-cost wrapper, label is phantom type
- **`MoreSecretThan<M>` trait** -- compile-time lattice ordering via trait bounds
- **`secret_block!` macro** -- lexically scoped access to secret values
- **`VisibleSideEffectFree` trait** -- prevents implicit information flows through side effects
- **Procedural macros** generate dual code paths: one for execution, one for type-checking
- **Zero runtime overhead** -- all checking happens at compile time

### 4b. Carapace (2025)

Extension of Cocoon adding both static and dynamic IFC with integrity labels (not just secrecy). Published at POPL 2025.

### Production Readiness

**Research-grade but impressive.** Cocoon was retrofitted onto two real Rust programs: the Spotify TUI client and Mozilla's Servo browser engine. It increases compile time but adds zero runtime overhead. The procedural macro approach is clever but introduces complexity (e.g., overloaded operators must be replaced with safe alternatives, `Drop`/`Deref` are restricted).

### Key Papers/Repos
- [Cocoon: Static Information Flow Control in Rust](https://arxiv.org/abs/2311.00097) (Hirsch & Cecchetti, OOPSLA 2024)
- [Carapace: Static-Dynamic IFC in Rust](https://dl.acm.org/doi/10.1145/3720427) (POPL 2025)

### Could This Port to TypeScript?

Cocoon's phantom-type approach maps cleanly to TypeScript branded types. The `Secret<T, L>` pattern is directly implementable. The challenge is that Cocoon relies on Rust's procedural macros for the effect system -- TypeScript has no compile-time macro system. However, a lint rule or `ts-morph` transform could approximate the `secret_block!` pattern. The trait-based lattice ordering could use conditional types.

---

## 5. TypeScript/JavaScript Approaches

### Current State

There are **no production IFC libraries for TypeScript**. However, the building blocks exist:

### Branded/Phantom Types for Security Labels

```typescript
// Phantom type brand
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

// Security levels as brands
type Public = Brand<string, "Public">;
type Internal = Brand<string, "Internal">;
type Confidential = Brand<string, "Confidential">;
type PHI = Brand<string, "PHI">;  // Protected Health Information

// Values can only be created through validated constructors
function markPublic(s: string): Public { return s as Public; }
function markPHI(s: string): PHI { return s as PHI; }

// Functions declare what security level they accept
function logToConsole(data: Public): void { console.log(data); }
function storeInVault(data: PHI): void { /* encrypted storage */ }

const patientName = markPHI("John Doe");
logToConsole(patientName);  // TYPE ERROR: PHI is not assignable to Public
storeInVault(patientName);  // OK
```

### Effect-TS Branded Types

Effect-TS has [first-class support for branded types](https://effect.website/docs/code-style/branded-types/):

```typescript
import { Brand } from "effect"

type PHI = string & Brand.Brand<"PHI">
const PHI = Brand.nominal<PHI>()

type SanitizedInput = string & Brand.Brand<"SanitizedInput">
const SanitizedInput = Brand.refined<SanitizedInput>(
  (s) => s.length > 0 && !s.includes("<script"),
  (s) => Brand.error(`Invalid input: ${s}`)
)
```

### What's Missing

TypeScript branded types provide **nominal type safety** but not **information flow tracking**. They prevent mixing up labeled values at function boundaries, but they don't:

1. Track implicit flows (branching on a secret value leaks information)
2. Enforce a lattice ordering (no `canFlowTo` check in the type system)
3. Prevent covert channels (timing, exceptions)
4. Provide declassification gates with authority proofs

A full IFC system would require either:
- A TypeScript compiler plugin (like FLAME for GHC)
- A custom ESLint rule suite that performs flow analysis
- A code generation / macro system (like Cocoon's proc macros)

### Key Resources
- [Effect-TS Branded Types Documentation](https://effect.website/docs/code-style/branded-types/)
- [Using Phantom Data Types in TypeScript](https://tey.sh/TIL/003_phantom_types_in_typescript)
- [type-brandy npm package](https://www.npmjs.com/package/type-brandy) (nominal typing library)

---

## 6. Komoroske's "Privacy Type-Checking" Vision

**Who:** Alex Komoroske, CEO of Common Tools (public benefit corp). Former Head of Corporate Strategy at Stripe, Director of Product Management at Google. Co-author of the [Resonant Computing Manifesto](https://resonantcomputing.org/) (December 2025).

### The Iron Triangle Problem

Komoroske identifies a fundamental constraint in modern software architecture -- the **"iron triangle"** -- where system designers can only enable two of three capabilities simultaneously:

1. **Sensitive data** (emails, photos, health records)
2. **Network access** (server communication)
3. **Untrusted code** (third-party / AI-generated software)

The same-origin policy (Netscape, 1995) chose to isolate apps from each other, creating data silos. Every app became a "fortress" -- secure but solitary. This architectural decision accidentally created the aggregation dynamics that produced Facebook, Google, and every data monopoly since.

### Data-Attached Policies (The Core Insight)

Komoroske's key proposal: **attach policies to data, not to applications.** Rather than asking "do I trust this app?", ask "does this computation respect the data's policies?"

Examples of data-attached policies:
- Photos: "Analyze locally but never transmit"
- Calendar: "Extract patterns but only share provably anonymous aggregates"
- Emails: "Allow reading but forbid forwarding"
- Health records: "Allow diagnostic computation but never expose raw values"

### The "Radioactive Code" Metaphor

In his [Bits and Bobs](https://groups.google.com/g/komoroske-updates/c/JTTbaZXGVxA) writings (July 2025), Komoroske describes code that touches sensitive data (like session tokens) as becoming **"radioactive"** -- in a safe system, tainted code should **auto-isolate itself**. This is directly analogous to information flow tracking: once a computation touches high-security data, its outputs inherit that classification.

He also describes **"Contextual Flow Control"** -- the ability to speculatively execute untrusted third-party code on sensitive data, safely. The policies themselves (not the app's origin) control what the code can do with the data.

### Technical Enforcement via Secure Enclaves

Komoroske's proposed enforcement mechanism: **hardware secure enclaves** (Intel SGX, ARM TrustZone, AMD SEV) providing:
- Fully encrypted memory regions inaccessible to cloud administrators
- **Remote attestation**: cryptographic proof of exactly what software is running inside the enclave
- ~10% computational overhead (vs ~10,000% for ZK proofs)

This breaks the iron triangle: untrusted code CAN access sensitive data AND have network access, because the hardware-enforced enclave guarantees the code cannot violate the data's attached policies.

### Connection to Helen Nissenbaum's Contextual Integrity

Komoroske explicitly references [contextual integrity](https://en.wikipedia.org/wiki/Contextual_integrity) as the "gold standard" of privacy: data is used in the context you understand, aligned with your interests. This maps naturally to a type system where data carries context labels and computations must prove they respect those contexts.

### What Komoroske Has NOT Published

Despite the evocative metaphors, Komoroske has **not published a formal specification** of "privacy type-checking" for computation graphs. The concept appears in his weekly writings and podcast appearances as an architectural vision, not as a type theory paper. The Resonant Computing Manifesto is philosophical/principles-based, not technically prescriptive.

The gap between Komoroske's vision and the academic IFC literature (Jif, FlowCaml, LIO, Cocoon) is that **the academic systems exist and work**, while Komoroske's framing provides the compelling product/architectural narrative for why this matters in the age of AI-generated software.

### Key Resources
- [Why Aggregators Ate the Internet](https://every.to/thesis/why-aggregators-ate-the-internet) (Komoroske, Every.to)
- [How One 1990s Browser Decision Created Big Tech's Data Monopolies](https://www.techdirt.com/2025/07/16/how-one-1990s-browser-decision-created-big-techs-data-monopolies-and-how-we-might-finally-fix-it/) (Techdirt, July 2025)
- [The Resonant Computing Manifesto](https://resonantcomputing.org/) (December 2025)
- [Komoroske's Bits and Bobs](https://komoroske.com/bits-and-bobs) (weekly writings)
- [He's Building AI for the Person You Want to Become](https://every.to/podcast/he-s-building-ai-for-the-person-you-want-to-become) (Every.to podcast)

---

## 7. Effect-TS Mapping: R Channel as Policy Encoding

### The Structural Opportunity

Effect-TS's `Effect<A, E, R>` has a phantom type parameter `R` (Requirements) that tracks what services a computation needs. This is structurally identical to how Haskell's MAC monad uses phantom labels:

```
MAC l a          ~  Effect<A, E, R>
label l          ~  requirement R
runMAC           ~  Effect.provide(layer)
ioTCB            ~  Effect.runSync (trusted escape)
```

The R channel uses **union types** (`R1 | R2` means "requires both R1 and R2") and is resolved via `Layer.provide`. A computation cannot execute until all its R requirements are satisfied -- the compiler enforces this.

### Proposed Pattern: Data Policies as Service Requirements

```typescript
// Define policy tags as services (phantom types)
export class HIPAAPolicy extends Context.Tag("HIPAAPolicy")<
  HIPAAPolicy,
  { readonly attestation: string; readonly auditLog: (event: string) => Effect.Effect<void> }
>() {}

export class PatientDataAccess extends Context.Tag("PatientDataAccess")<
  PatientDataAccess,
  { readonly patientId: string; readonly consentScope: ReadonlyArray<string> }
>() {}

export class EncryptionRequired extends Context.Tag("EncryptionRequired")<
  EncryptionRequired,
  { readonly algorithm: "AES-256-GCM"; readonly keyId: string }
>() {}

// A computation that touches patient data
// TYPE SIGNATURE ENCODES THE POLICIES IT REQUIRES
const analyzePatientRisk = (
  patientId: string
): Effect.Effect<RiskScore, AnalysisError, PatientDataAccess | HIPAAPolicy | EncryptionRequired> =>
  Effect.gen(function* () {
    const hipaa = yield* HIPAAPolicy
    const access = yield* PatientDataAccess
    const encryption = yield* EncryptionRequired

    // Audit the access
    yield* hipaa.auditLog(`risk-analysis:${access.patientId}`)

    // The computation can proceed -- all policies are satisfied
    // ...
    return riskScore
  })

// CANNOT RUN without providing all policy layers:
// Effect.runPromise(analyzePatientRisk("P001"))
//   ^^^^^^^^ TYPE ERROR: missing HIPAAPolicy, PatientDataAccess, EncryptionRequired

// Must provide all policy layers:
const program = analyzePatientRisk("P001").pipe(
  Effect.provide(HIPAAPolicyLive),
  Effect.provide(PatientDataAccessLive),
  Effect.provide(EncryptionRequiredLive),
)
```

### What This Buys You

1. **Compile-time policy enforcement:** A function that touches patient data cannot execute without HIPAA attestation -- the TypeScript compiler rejects it.
2. **Policy composition:** `R1 | R2 | R3` naturally composes multiple policies.
3. **Declassification as Layer provision:** Providing a policy Layer is an explicit act of attestation -- it requires constructing a proof (the service implementation).
4. **Audit trail:** Policy services can log every access.
5. **No runtime overhead for type checking:** The R parameter is phantom -- erased at runtime.

### What This Does NOT Buy You

1. **No implicit flow tracking:** If you branch on a patient's diagnosis and return different public results, the type system does not catch this. Jif and Cocoon do.
2. **No lattice enforcement:** There is no built-in `canFlowTo` ordering. You could encode it with conditional types, but it is not automatic.
3. **No covert channel protection:** Timing, exceptions, and memory allocation can leak information.
4. **Escape hatches exist:** `as any`, `Effect.runSync`, and other unsafe coercions bypass the type system.

### Enhancing the Pattern

To get closer to full IFC, you could layer additional mechanisms:

```typescript
// 1. Branded types for labeled values
type PHI<T> = T & Brand.Brand<"PHI">
type Anonymized<T> = T & Brand.Brand<"Anonymized">

// 2. Declassification gates that require proof
const anonymize = (
  data: PHI<PatientRecord>
): Effect.Effect<Anonymized<AggregateStats>, Error, HIPAAPolicy | AnonymizationProof> =>
  Effect.gen(function* () {
    const proof = yield* AnonymizationProof  // Must provide k-anonymity attestation
    // ... perform anonymization ...
    return result as Anonymized<AggregateStats>
  })

// 3. Pipeline composition tracks policy accumulation
const pipeline = fetchPatientData.pipe(           // R: PatientDataAccess | EncryptionRequired
  Effect.flatMap(analyzeRisk),                    // R: + HIPAAPolicy
  Effect.flatMap(anonymize),                      // R: + AnonymizationProof
  Effect.flatMap(publishInsight),                 // R: + PublicationPolicy
)
// pipeline :: Effect<PublishedInsight, Error,
//   PatientDataAccess | EncryptionRequired | HIPAAPolicy | AnonymizationProof | PublicationPolicy>
```

### Has Anyone Explored This?

No published work specifically explores encoding IFC policies in Effect-TS's R channel. The closest precedents are:
- Effect-TS's own `HttpApiSecurity` module, which uses service tags for auth
- The general pattern of "phantom types as capabilities" seen in Rust (Cocoon) and Haskell (MAC)
- [PaulJPhilp/EffectPatterns](https://github.com/PaulJPhilp/EffectPatterns) documents community patterns but does not cover IFC

This is greenfield territory.

---

## Assessment: Could This Work for Maslow?

### The Short Answer

**Yes, partially, and it is worth doing.** You can get 70-80% of the value of a privacy type system using Effect-TS's existing machinery, without any custom compiler work.

### What You Can Build Today

| Capability | Mechanism | Effort |
|-----------|-----------|--------|
| Compile-time policy requirements | R channel + Context.Tag | Low |
| Branded types for data classification | Brand module | Low |
| Declassification gates with proof | Service tags requiring attestation | Medium |
| Pipeline policy accumulation | Effect.flatMap composition | Low |
| Audit logging per policy | Service implementations | Low |
| Runtime schema validation | Effect Schema + Brand | Low |

### What Would Require Research/Custom Tooling

| Capability | Mechanism | Effort |
|-----------|-----------|--------|
| Implicit flow tracking | Custom ESLint plugin or ts-morph | High |
| Lattice ordering enforcement | Conditional types + custom type checker | High |
| Covert channel protection | Runtime monitoring, not type-level | Very High |
| Formal noninterference proof | Requires formal methods expertise | Research |

### Recommended Path for Maslow

1. **Phase 1:** Define policy tags for Maslow's data domains (patient data, session data, configuration, public). Use `Context.Tag` services that carry attestation proofs. Every Effect pipeline that touches patient data must satisfy the `HIPAAPolicy` requirement in its R channel. This is achievable today with zero new tooling.

2. **Phase 2:** Add `Brand.nominal` types for data classification (`PHI`, `PII`, `SessionSecret`, `Public`). Functions that cross classification boundaries must go through explicit declassification gates that require both a policy service AND a branded proof token.

3. **Phase 3 (stretch):** Build a custom ESLint rule that verifies no function accepting `PHI`-branded input produces `Public`-branded output without going through a registered declassification gate. This approximates FlowCaml's inference for the specific patterns you care about.

### The Komoroske Connection

What Komoroske describes -- data with attached policies, computations verified against those policies before execution -- maps directly to this architecture. The "computation graph" is Effect's dependency graph. "Type-checking against policies" is the R channel enforcement. "Radioactive code" is a function whose R channel accumulates policy requirements as it touches classified data. The difference from Komoroske's vision is that he wants hardware enforcement via secure enclaves, while this approach uses the TypeScript compiler as the enforcement boundary. Both are valid at different trust levels.

---

## Summary Table

| System | Language | Static/Dynamic | Maintained | Production-Ready | Key Innovation |
|--------|----------|---------------|------------|-----------------|----------------|
| **Jif** | Java | Static | Yes (2025) | Research | Decentralized Label Model |
| **FlowCaml** | OCaml | Static (inferred) | No (~2003) | Abandoned | Full type inference for IFC |
| **LIO** | Haskell | Dynamic | Yes | Research+ | Labeled IO monad, Hails web framework |
| **MAC** | Haskell | Static | Yes | Research | Compile-time IFC via phantom types |
| **FLAME** | Haskell | Static | Research | Research | GHC plugin, flow-limited authorization |
| **Cocoon** | Rust | Static | Yes (2024) | Research | IFC via unmodified Rust compiler |
| **Carapace** | Rust | Static+Dynamic | Yes (2025) | Research | Extends Cocoon with integrity |
| **Effect-TS R** | TypeScript | Static (partial) | Yes | Production | Policy requirements as phantom types |

The field is mature in theory (30+ years of research) but no mainstream language has adopted IFC natively. The best path forward for TypeScript/Effect-TS is to encode what the type system can express (policy requirements, branded classification, declassification gates) and accept that implicit flow tracking requires additional tooling beyond the type checker.
