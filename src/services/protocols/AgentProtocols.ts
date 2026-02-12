/**
 * Agent Protocol Templates
 *
 * Standardized research and implementation protocols for autonomous agents.
 */

export const DEEP_RESEARCH_PROTOCOL = `## Deep Research Protocol (MANDATORY)

Before writing ANY code, you MUST complete all 3 research passes. Do not skip passes. Each pass has a specific adversarial lens.

### Pass 1: Forward Trace (Understand the Happy Path)
Lens: "What does this code do today?"
1. Trace the entry point — find the user action, API call, or trigger that starts the flow.
2. Follow every function call — read each file, note the exact line numbers.
3. Document the data shape at each boundary (function args, API request/response, DTOs).
4. Map the dependency chain — what packages, services, and external APIs are involved?
5. Identify the exit point — where does the result surface to the user?

Output a trace document with a Mermaid diagram showing the flow, every file involved, and the data transformations at each step.
Self-check: Can I draw the complete flow from trigger to user-visible result? Did I read every file, or did I assume? Are there parallel paths or branching logic I haven't followed?

### Pass 2: Inventory Audit (What exists but isn't connected?)
Lens: "What did I miss? What's built but not wired?"
1. Search for siblings — if you found FooDisk.ts, search find_by_name *Disk* in the same directory. List ALL of them.
2. Search for pipelines — find every pipeline definition, not just the one currently called.
3. Check reference documents — look for design briefs, architecture docs, READMEs in the relevant directories. Check the user's Downloads folder and open editor tabs for context docs.
4. Cross-reference — for every component in the trace, ask: "Is there a newer/better/more complete version that exists but isn't used?"
5. Check the card description — did you trace EVERYTHING the card asks about, or just a subset?

Output an inventory table: Component | Code Exists? | Wired In? | Status
Self-check: Did I search broadly (glob patterns, not just exact names)? Did I check reference docs? Does my inventory cover 100% of components in this domain?

### Pass 3: Interface Contract Validation (Do the seams match?)
Lens: "Even if each piece works internally, do they fit together?"
For every boundary between systems (client-server, package-consumer, DTO-schema):
1. Schema alignment — compare field names, types, casing, and nesting between sender and receiver. PascalCase vs camelCase is a classic miss.
2. Response envelope — does the client expect flat data or a wrapper like { success, data, error }?
3. Auth flow — trace the auth token/key from storage to header to middleware to handler. Is every step connected?
4. Import resolution — can the importing package actually resolve the path? Check package.json exports, symlinks, barrel files (index.ts).
5. Build compatibility — check language versions, framework versions, and serialization library capabilities.
6. Environment variables — list every env var the code reads. Are they set in the deployment environment?

Output a bug table: Bug # | Description | File:Line | Evidence
Self-check: Did I literally compare the sender's output shape against the receiver's expected input, field by field? Did I check that every import path resolves? Did I verify env vars are set, not just referenced?

### Workflow Rules
1. Complete all 3 passes before writing the implementation plan. No exceptions.
2. Loop back if needed. If Pass 3 reveals issues, loop back to the relevant earlier pass and re-run it. Keep looping until Pass 3 produces no new issues.
3. Split large plans. If the implementation plan exceeds ~200 lines, split it into phases. Each phase should be independently deployable and verifiable.
4. Stop when stable. The protocol is complete when Pass 3 produces no changes to the plan.

### THEN and ONLY THEN: Write Your Implementation Plan
Based on ALL 3 passes, write your plan. Reference specific findings from each pass. The plan should:
1. Address every bug found in Pass 3
2. Use existing components found in Pass 2 (don't rebuild what exists)
3. Follow the exact data flow mapped in Pass 1
`

/**
 * Lean task protocol for Ollama (local LLM) agents.
 * Designed for 8B parameter models with 8K context windows.
 * Keeps instructions tight and output-format focused.
 */
export const OLLAMA_TASK_PROTOCOL = `## Rules
1. Read all provided files carefully before making changes.
2. Make the minimum changes needed to complete the task.
3. Follow coding standards exactly (no semicolons, double quotes, 2-space indent).
4. Do not add new imports or dependencies unless the task requires them.
5. Do not rename or restructure code beyond what the task asks for.
6. Ensure all TypeScript types are correct (strict mode).
7. Output ONLY <edit> blocks. No explanations, no commentary.`