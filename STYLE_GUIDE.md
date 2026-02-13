# Maslow — Style Guide

Engineering principles and decision-making philosophy. For formatting rules, architecture patterns, and tool-specific conventions, see [CLAUDE.md](./CLAUDE.md).

This guide applies to all contributors — human and agent alike.

---

## Decompose, Decompose, Decompose

This is the foundational skill. Every other principle in this guide depends on it.

A problem you can't decompose is a problem you can't solve cleanly. A function that does five things is five bugs waiting to happen. A PR that touches twelve concerns is twelve reviews crammed into one.

**Break everything down:**

- **Problems** — before writing code, break the task into independent sub-problems. Each sub-problem should be solvable without thinking about the others. If you can't decompose it, you don't understand it yet.
- **Functions** — one function, one job. If you're naming a function with "and" in it (`validateAndSave`, `fetchAndTransform`), split it. Each function should be testable in isolation.
- **Services** — each Effect service owns one domain. `Kanban` owns work coordination. `AppPersistence` owns storage. `AgentOrchestrator` owns agent lifecycle. If a service is growing a second responsibility, extract a new service.
- **Files** — a file should be about one thing. When a file crosses ~300 lines, look for a seam to split on. AppServer.ts is already large — don't make it worse.
- **Commits** — one logical change per commit. A bug fix is not a refactor is not a feature. Atomic commits are easier to review, revert, and bisect.
- **PRs** — a PR should be reviewable in one sitting. If it's touching 10+ files across multiple concerns, it's too big. Split into stacked PRs or phases.
- **Plans** — if an implementation plan exceeds ~200 lines, split it into independently deployable phases. Each phase should be verifiable on its own.

**The test:** Can you explain what this thing does in one sentence without using "and"? If not, decompose further.

## Consistency Over Cleverness

Before writing anything new, look at how the codebase already handles the same problem. Match the pattern.

- Adding a service? Follow the `Context.Tag` + `Layer.effect` pattern in the existing services.
- Adding an endpoint? Match the request parsing, response envelope, and error handling in AppServer.ts.
- Adding a WebSocket message? Follow the `noun.verb` naming convention (`card.assigned`, `agent.spawned`).
- Adding a database column? Use the `ALTER TABLE ADD COLUMN` migration pattern in AppPersistence.ts.
- Adding a kanban method? Mirror the pattern in Kanban.ts — delegate to AppPersistence, wrap in Effect.

A codebase that reads like it was written by one person is easier to maintain than one full of individually brilliant but inconsistent solutions.

## Keep It Simple

The right solution accomplishes the task without creating problems down the road. Premature abstraction is more expensive than duplication. Three similar lines are better than a helper with one call site.

- Solve the problem in front of you, not a hypothetical future version of it
- Write code a tired person can understand at 10pm on the couch
- Don't add configuration options nobody asked for
- Don't build abstractions for one-time operations
- Don't add feature flags or backwards-compatibility shims — just change the code

## Refactor When It Hurts

When a new feature needs a different structure, or a bug reveals a design problem, fix the root cause. The quick fix and the right fix are often different things. Choose the right fix.

Don't refactor speculatively. Refactor when the current structure actively resists what you're trying to do.

## Find the Root Cause

Surface-level fixes create surface-level stability. When something breaks, trace it all the way down. Understand *why* it broke, not just *what* broke.

The question is always: "Why does this happen?" not "How do I make this stop?"

If you can't explain the root cause, you haven't found it yet. The abstraction will leak again.

## Don't Copy-Paste

When you copy-paste code, you copy bugs and forget to change the details. Variables that should differ stay the same. Method calls that should point elsewhere still point to the original.

If you find a solution online, understand it first. Then write your own version that fits this codebase. If two blocks look almost identical, either extract a shared function or accept the duplication consciously — don't copy and tweak.

## Delete What You Don't Need

Don't comment code out "just in case." That's what git is for. Commented-out code clutters files and creates confusion about what's actually running.

If a function, variable, or file is unused — remove it. No `_unused` renames, no `// removed` comments, no re-exports for backwards compatibility. Push before you delete if you want a safety net. Then delete with confidence.

## Optimize When It Matters

Write clear, correct code first. When performance becomes a measurable problem, profile it, find the bottleneck, and fix that specific thing.

Optimized code is often harder to read and maintain. The trade-off is only worth it when the gain is real and necessary — not hypothetical.

---

## Effect-TS Judgment Calls

CLAUDE.md defines the service pattern. This section covers when to reach for what.

**`Layer.effect` vs `Layer.scoped`** — use `Layer.scoped` with `Effect.addFinalizer` when the service holds resources that need cleanup (DB connections, HTTP servers, child processes, intervals). Use `Layer.effect` for stateless services or services with no teardown.

**`Effect.sync` vs `Effect.tryPromise`** — `better-sqlite3` is synchronous. Wrap its calls in `Effect.sync`, never `Effect.tryPromise`. Use `Effect.tryPromise` only for actual async operations (fetch, child process completion, file I/O).

**Error channel** — always specify it: `Effect.Effect<A, E>`, not `Effect.Effect<A>`. Prefer domain-specific tagged errors (`{ _tag: "CardNotFound" }`) over generic `Error`. This makes error handling in upstream layers precise.

**`Effect.gen` vs pipe chains** — use `Effect.gen` for sequential logic with multiple steps. Use `pipe` + `Effect.map`/`Effect.flatMap` for simple one-step transformations. Don't mix `async/await` with `Effect.gen` — they're different worlds.

**Config optionals** — `Config.option` returns an `Option` type. Always check `._tag === "Some"` before accessing `.value`. Don't `as`-cast your way past it.

---

## Agent-Authored Code

Spawned agents (Claude, Codex, Gemini) are contributors. They follow every rule in this guide, plus:

- **Branch naming:** `agent/<type>/<slug>-<id>` (e.g., `agent/claude/fix-heartbeat-42`)
- **Deep research protocol:** mandatory 6-pass research before implementation. No exceptions. See `.claude/deep-research-protocol.md`.
- **PR format:** every PR includes a `verification-prompt.md` with acceptance criteria for the reviewing agent.
- **Concurrency:** max 3 agents running, max 1 per project. The orchestrator enforces this.
- **Context snapshots:** save working state to the kanban card before exiting. The next agent (or human) picks up where you left off.

**Rejection criteria** — a PR from an agent will be rejected if it:
- Skips or shortcuts the deep research protocol
- Introduces `any` types or `as` casts without justification
- Touches files outside the scope of the kanban card
- Breaks existing tests
- Adds dead code, commented-out code, or TODO hacks
- Violates boundary rules (importing across app/package/server lines)
- Changes behavior without updating or adding tests

---

## Naming

Names describe *what* something is, not *how* it works internally. `getNextCard` beats `queryDbForHighestPriorityBacklogCardAndReturnFirst`.

- **Files:** kebab-case for scripts/config, PascalCase for service modules (matching the class name)
- **Variables and functions:** camelCase
- **Types and interfaces:** PascalCase
- **Constants:** SCREAMING_SNAKE_CASE for true constants, camelCase for derived values
- **Booleans:** prefix with `is`, `has`, `should`, `can` (`isAlive`, `hasContext`)
- **WebSocket messages:** `noun.verb` (`card.assigned`, `agent.spawned`, `agent.failed`)

## Comments

Write comments that explain *why*, not *what*. The code already says what. A comment should tell you something the code can't — the business reason, the gotcha, the trade-off, the "this looks wrong but it's intentional because..."

Don't add comments to code you didn't change. Don't add JSDoc to every function. Add comments where the logic isn't self-evident or where future-you would be confused.

## Error Handling

Handle errors at the boundary where you can do something meaningful. Don't catch just to re-throw. Don't swallow silently.

In Effect-TS, let errors propagate up the layer stack until a layer knows how to handle them. The service that owns the domain decides the recovery strategy — not the caller, not the callee.

## Database Migrations

- New columns: `ALTER TABLE ADD COLUMN` wrapped in a try-catch (column may already exist)
- New indexes: `CREATE INDEX IF NOT EXISTS`
- Never drop columns or tables in a migration — add, don't subtract
- Use JSON columns for flexible metadata that doesn't need querying. Use structured columns for anything you'll filter or sort on.
- All queries via prepared statements in the `stmts` object. No inline SQL.

## Git Discipline

- Commit often, push often — small commits are easier to review and revert
- Commit messages explain *why*, not *what*
- One logical change per commit — don't mix a bug fix with a refactor
- Don't commit commented-out code, console.logs, or TODO hacks

---

## Quality Tooling

The principles above are easier to follow when the tools enforce them.

**Linting** — ESLint enforces boundary rules, catches `any` types, flags unused variables. Treat warnings as early signals, not noise. Don't suppress without a comment explaining why.

**Type checking** — strict mode is non-negotiable. If the type checker complains, the code is wrong. Don't reach for `as` casts or `any` to silence it. Narrow the type or fix the underlying issue.

**Testing** — test behavior, not internals. A test should answer "does this do what the user expects?" Tests are documentation — a well-named test tells the next developer what the code is supposed to do.

**Code review** — every PR gets reviewed. The reviewer checks the work against the goals, not just the syntax. Every PR includes `verification-prompt.md` directing the reviewer on what to verify. "This looks fine" is not a review.

**Push often** — if it's not pushed, it doesn't exist. Small, frequent commits. GitHub is the source of truth.

---

## When In Doubt

1. Decompose it further
2. Look at what was done before
3. Keep it simple
4. Fix the root cause
5. Delete what you don't need
6. Ask — it's faster than guessing wrong
