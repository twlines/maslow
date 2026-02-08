/**
 * Agent Prompt Builder
 *
 * Assembles the full prompt for an agent session from project context,
 * board state, architecture decisions, steering corrections, and the
 * deep research protocol.
 */

import { Effect } from "effect"
import type { AppPersistence } from "../AppPersistence.js"
import type { Kanban } from "../Kanban.js"
import type { SteeringEngine } from "../SteeringEngine.js"

const MAX_DOC_CHARS = 2000
const MAX_PROMPT_CHARS = 50000

const truncate = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max - 3) + "..." : text

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

interface PromptDeps {
  db: AppPersistence["Type"]
  kanban: Kanban["Type"]
  steering: SteeringEngine["Type"]
}

interface CardInput {
  id: string
  title: string
  description: string
  contextSnapshot: string | null
  projectId: string
}

export function buildAgentPrompt(
  deps: PromptDeps,
  card: CardInput,
  _userPrompt: string,
): Effect.Effect<string, never> {
  const { db, kanban, steering } = deps

  return Effect.gen(function* () {
    const sections: string[] = []

    // --- 1. Identity ---
    sections.push(`## Identity

You are an autonomous build agent in the Maslow system. You are working in an isolated git worktree on a feature branch. Your job: implement the kanban card below, ensure it compiles and lints cleanly, commit your changes, and stop. The orchestrator handles push and PR creation — do NOT push or create PRs yourself.

You have access to CLAUDE.md in the repo root which defines engineering standards, patterns, and gotchas. Read it before writing code.`)

    // --- 2. Project context ---
    const project = yield* db.getProject(card.projectId).pipe(
      Effect.orElseSucceed(() => null)
    )
    if (project) {
      let projectSection = `## Project: ${project.name}\n\n`
      if (project.description) {
        projectSection += `${project.description}\n\n`
      }

      const docs = yield* db.getProjectDocuments(card.projectId).pipe(
        Effect.orElseSucceed(() => [] as Array<{ type: string; title: string; content: string }>)
      )
      const docTypes = ["brief", "instructions", "assumptions"] as const
      for (const docType of docTypes) {
        const doc = docs.find(d => d.type === docType)
        if (doc && doc.content.trim()) {
          projectSection += `### ${doc.title || docType}\n${truncate(doc.content, MAX_DOC_CHARS)}\n\n`
        }
      }

      sections.push(projectSection.trimEnd())
    }

    // --- 3. Architecture decisions ---
    const decisions = yield* db.getDecisions(card.projectId).pipe(
      Effect.orElseSucceed(() => [] as Array<{ title: string; reasoning: string; tradeoffs: string }>)
    )
    if (decisions.length > 0) {
      let decisionSection = `## Architecture Decisions\n\n`
      for (const d of decisions.slice(0, 10)) {
        decisionSection += `- **${d.title}**: ${truncate(d.reasoning, 200)}`
        if (d.tradeoffs) {
          decisionSection += ` (tradeoffs: ${truncate(d.tradeoffs, 100)})`
        }
        decisionSection += `\n`
      }
      sections.push(decisionSection.trimEnd())
    }

    // --- 4. Board context (sibling awareness) ---
    const board = yield* kanban.getBoard(card.projectId).pipe(
      Effect.orElseSucceed(() => ({ backlog: [], in_progress: [], done: [] }))
    )
    const inProgress = board.in_progress.filter(c => c.id !== card.id)
    const recentDone = board.done.slice(0, 10)

    if (inProgress.length > 0 || recentDone.length > 0) {
      let boardSection = `## Board Context\n\n`
      if (inProgress.length > 0) {
        boardSection += `**In Progress (other agents working now):**\n`
        for (const c of inProgress) {
          boardSection += `- "${c.title}" — ${c.assignedAgent || "unassigned"}, status: ${c.agentStatus || "unknown"}\n`
        }
        boardSection += `\n`
      }
      if (recentDone.length > 0) {
        boardSection += `**Recently Completed:**\n`
        for (const c of recentDone) {
          boardSection += `- "${c.title}"\n`
        }
      }
      sections.push(boardSection.trimEnd())
    }

    // --- 5. Card brief (the actual task) ---
    let taskSection = `## Task\n\n**${card.title}**\n\n${card.description}`
    if (card.contextSnapshot) {
      taskSection += `\n\n### Previous Context\n\nThis card was previously worked on. Here's where we left off:\n\n${card.contextSnapshot}`
    }
    sections.push(taskSection)

    // --- 6. Steering corrections ---
    const steeringBlock = yield* steering.buildPromptBlock(card.projectId)
    if (steeringBlock) {
      sections.push(steeringBlock)
    }

    // --- 7. Deep research protocol ---
    sections.push(DEEP_RESEARCH_PROTOCOL)

    // --- 8. Completion checklist ---
    sections.push(`## When Done

1. Ensure all changes compile and lint cleanly (\`npm run type-check && npm run lint\`)
2. Create a verification-prompt.md in the repo root with:
   - The card title and goals
   - Acceptance criteria (checklist)
   - Specific verification steps
   - List of files changed
3. Commit all changes with a descriptive message
4. Do NOT push or create a PR — the orchestrator handles that`)

    // --- Assemble with token budget guard ---
    let prompt = sections.join("\n\n")

    // Progressive truncation if over budget
    if (prompt.length > MAX_PROMPT_CHARS) {
      const decIdx = sections.findIndex(s => s.startsWith("## Architecture Decisions"))
      if (decIdx >= 0) sections.splice(decIdx, 1)
      prompt = sections.join("\n\n")
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      const boardIdx = sections.findIndex(s => s.startsWith("## Board Context"))
      if (boardIdx >= 0) sections.splice(boardIdx, 1)
      prompt = sections.join("\n\n")
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      const projIdx = sections.findIndex(s => s.startsWith("## Project:"))
      if (projIdx >= 0) sections.splice(projIdx, 1)
      prompt = sections.join("\n\n")
    }

    return prompt
  })
}
