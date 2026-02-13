---
name: effect-testing
description: Effect-TS testing patterns with Vitest
scope: both
domain: code
context-budget: 300
---

# Effect-TS Testing

## Basic Test Structure
```typescript
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { Foo, FooLive } from "../services/Foo.js"

describe("Foo", () => {
  it("does the thing", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const foo = yield* Foo
        return yield* foo.doThing()
      }).pipe(Effect.provide(testLayer))
    )
    expect(result).toBe(expected)
  })
})
```

## Mock Services with Layer.succeed
```typescript
const MockDep = Layer.succeed(Dep, {
  getValue: () => Effect.succeed("mock-value"),
  save: () => Effect.succeed(undefined),
})
```

## Composing Test Layers
```typescript
const testLayer = FooLive.pipe(
  Layer.provide(MockDep),
  Layer.provide(MockConfig),
)
```

## Testing Errors
```typescript
it("fails with NotFound", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const foo = yield* Foo
      return yield* foo.getById("nonexistent")
    }).pipe(Effect.provide(testLayer))
  )
  expect(exit._tag).toBe("Failure")
})
```

## Config in Tests
```typescript
const MockConfig = Layer.succeed(ConfigService, {
  database: { path: ":memory:" },
  server: { port: 0 },
  // ... minimal config for the test
})
```

## Rules
- Every test layer must provide ALL dependencies the service needs
- Use `Layer.succeed` for mocks — not `Layer.effect`
- Do NOT use `Effect.runSync` for async operations in tests
- Test timeout is 10 seconds — keep tests fast
- Name test files `*.test.ts` in `src/__tests__/`
