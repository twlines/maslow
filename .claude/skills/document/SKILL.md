---
name: document
description: Generate structured code documentation for files, services, or modules. Use when the user asks to document code, understand a module, generate API docs, or wants a reference for a service. Invoke with /document <path-or-module-name>.
---

# Code Documentation Generator

Generate structured, accurate documentation for Maslow codebase modules. Documentation is derived from reading the actual code — never fabricated.

## Workflow

1. **Identify the target** — file path, service name, or module directory
2. **Read all relevant source files** — the target and its direct dependencies
3. **Analyze** — extract the API surface, data flow, dependencies, and patterns
4. **Generate documentation** — write structured markdown following the template below
5. **Output** — print the documentation to the conversation (do NOT write files unless explicitly asked)

## Output Template

Generate documentation following this structure:

```markdown
# <Module Name>

> One-sentence purpose.

## Overview

2-3 sentences explaining what this module does, why it exists, and where it sits in the architecture.

## API Surface

### Public Interface

For each exported function/method/class:
- **`methodName(params): ReturnType`** — what it does (one line)

### Configuration

Environment variables, config keys, or constructor options this module depends on.

## Data Flow

How data moves through this module — what comes in, what goes out, what side effects occur.
Use a simple arrow diagram if helpful:

```
Input → Transform → Output
          ↓
       Side Effect
```

## Dependencies

| Dependency | Why |
|-----------|-----|
| ServiceName | Brief reason |

## Database Schema (if applicable)

Tables, columns, indexes this module owns or queries.

## Error Handling

How errors are surfaced — Effect error channel types, fallback behavior, retry logic.

## Gotchas

Bullet list of non-obvious behaviors, footguns, or constraints a developer should know.

## Example Usage

```typescript
// Minimal working example showing how to use this module
```
```

## Rules

- **Read before documenting** — never guess at APIs or behavior. Read the source.
- **Be precise** — use actual type names, actual method signatures. No placeholders.
- **Skip empty sections** — if a module has no database schema, omit that section entirely.
- **Effect-TS aware** — document `Effect.Effect<A, E>` signatures with both success and error channels. Note `Layer` dependencies.
- **Concise** — this is reference material, not a tutorial. One line per method unless complexity demands more.
- **Link to source** — reference file paths with line numbers for key definitions (e.g., `src/services/Kanban.ts:42`).

## Scope Handling

| Input | Action |
|-------|--------|
| File path (e.g., `src/services/Kanban.ts`) | Document that single file |
| Service name (e.g., `Kanban`) | Find and document the service file |
| Directory (e.g., `packages/shared`) | Document the module: index exports, key files, package purpose |
| `all` or `full` | Generate a high-level architecture doc covering all services and their relationships |

## Architecture Context

This codebase follows the Effect-TS service layer pattern:
- Services are defined as `Context.Tag` with a service interface
- Implementations are `Layer.effect` or `Layer.scoped` (for resources with finalizers)
- Layer composition order matters — see CLAUDE.md for the dependency graph
- Boundary rules: `apps/*` → `packages/*` only, `src/` → `packages/*` only
