---
name: test-writing
description: Test scaffolding protocol for Vitest in Maslow
scope: both
domain: code
context-budget: 250
---

# Test Writing Protocol

## Framework
- Vitest with v8 coverage
- Test files: `src/__tests__/**/*.test.ts`
- Timeout: 10 seconds default

## Structure
```typescript
import { describe, it, expect } from "vitest"

describe("ModuleName", () => {
  describe("functionName", () => {
    it("should handle the happy path", () => {
      // Arrange
      // Act
      // Assert
    })

    it("should handle edge case", () => {
      // ...
    })
  })
})
```

## Rules
- Test behavior, not implementation
- One assertion per test when practical
- Name tests as "should [expected behavior]"
- Mock external dependencies (DB, network, filesystem)
- For Effect services, test the returned service object directly
- Do NOT test private functions — test through the public interface
- Do NOT add tests for trivial getters/setters

## Effect Service Testing
```typescript
const service = Effect.runSync(
  Effect.gen(function* () {
    return yield* MyService
  }).pipe(Effect.provide(TestLayer))
)
```
