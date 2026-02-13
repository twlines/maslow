---
name: effect-conventions
description: Effect-TS patterns and anti-patterns for Maslow codebase
scope: ollama
domain: code
context-budget: 300
requires:
  - ConfigService
---

# Effect-TS Conventions

## Service Pattern
Every service follows Context.Tag + Layer.effect:
```typescript
export interface FooService {
  doThing(): Effect.Effect<Result, Error>
}
export class Foo extends Context.Tag("Foo")<Foo, FooService>() {}
export const FooLive = Layer.effect(Foo, Effect.gen(function* () {
  const dep = yield* SomeDependency
  return { doThing: () => ... }
}))
```

## Rules
- Use `Layer.scoped` with `Effect.addFinalizer` for resources (DB, HTTP, processes)
- Wrap `better-sqlite3` in `Effect.sync()`, NOT `Effect.tryPromise()`
- Use `Effect.gen(function* () { ... })` for sequential flows
- `Config.option()` returns `Option` type — check `._tag === "Some"`
- Always specify error channel: `Effect.Effect<A, E>`, not `Effect.Effect<A>`
- No `any` — use `unknown` and narrow
- No `as` casts unless structural compatibility is proven

## Anti-Patterns
- Do NOT use `await` inside Effect generators
- Do NOT use `Effect.tryPromise()` for synchronous operations
- Do NOT create services without a Context.Tag
- Do NOT import from `effect/internal/*`
