---
name: effect-service
description: Scaffold a new Effect-TS service following Maslow's Context.Tag + Layer pattern. Use when the user wants to create a new service, add a new module to the server, or needs Effect-TS boilerplate. Invoke with /effect-service <ServiceName> [--scoped] [--deps Dep1,Dep2].
---

# Effect-TS Service Scaffolder

Generate a new service file following Maslow's established patterns. Every service in this codebase uses `Context.Tag` for dependency injection and `Layer.effect` (or `Layer.scoped` for resource-holding services) for implementation.

## Workflow

1. **Parse arguments** — service name, whether it's scoped, and its dependencies
2. **Read existing services** to match the codebase's exact style (import paths, naming conventions, semicolons, etc.)
3. **Generate the service file** at `src/services/<ServiceName>.ts`
4. **Wire into layer composition** — update `src/index.ts` to import and compose the new layer
5. **Generate test stub** at `src/__tests__/<ServiceName>.test.ts`

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `ServiceName` | Yes | PascalCase name (e.g., `CrossProjectConnector`) |
| `--scoped` | No | Use `Layer.scoped` with `Effect.addFinalizer` for services holding resources (DB connections, HTTP servers, child processes) |
| `--deps Dep1,Dep2` | No | Comma-separated list of service dependencies (e.g., `AppPersistence,Config`) |
| `--methods method1,method2` | No | Comma-separated list of method stubs to generate |

## Service Template (Layer.effect)

```typescript
import { Context, Effect, Layer } from "effect"
// import dependencies as needed

export interface <Name>Service {
  // method stubs
}

export class <Name> extends Context.Tag("<Name>")<
  <Name>,
  <Name>Service
>() {}

export const <Name>Live = Layer.effect(
  <Name>,
  Effect.gen(function* () {
    // yield* dependencies
    return {
      // method implementations
    }
  })
)
```

## Service Template (Layer.scoped)

```typescript
import { Context, Effect, Layer, Scope } from "effect"

export interface <Name>Service {
  // method stubs
}

export class <Name> extends Context.Tag("<Name>")<
  <Name>,
  <Name>Service
>() {}

export const <Name>Live = Layer.scoped(
  <Name>,
  Effect.gen(function* () {
    // yield* dependencies
    // resource setup

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        // cleanup logic
      })
    )

    return {
      // method implementations
    }
  })
)
```

## Style Rules

These MUST match the existing codebase exactly:
- No semicolons
- Double quotes for strings
- 2-space indentation
- Explicit return types on service interface methods using Effect types
- Always specify the error channel: `Effect.Effect<A, E>`, not just `Effect.Effect<A>`
- No barrel exports — import from specific files
- Use `unknown` instead of `any` — narrow with type guards

## Layer Composition

After generating the service, read `src/index.ts` and wire the new layer into the composition chain. Follow the existing dependency order:

```
Config
  → Persistence, Telegram, AppPersistence, Voice, ClaudeMem, SoulLoader
    → Kanban, ThinkingPartner
    → ClaudeSession
      → SessionManager
      → AppServer
```

Place the new service at the correct level based on its dependencies.

## Test Stub Template

```typescript
import { describe, it, expect } from "vitest"

describe("<Name>", () => {
  it("should be implemented", () => {
    expect(true).toBe(true)
  })
})
```

## Before Writing

1. **Read `src/index.ts`** to understand current layer composition
2. **Read at least one existing service** (e.g., `src/services/Kanban.ts`) to match exact style
3. **Check for naming conflicts** — ensure the service name isn't already taken
4. **Verify dependencies exist** — each `--deps` entry must be an existing service
