---
name: import-conventions
description: Import path and module boundary rules
scope: ollama
domain: code
context-budget: 150
---

# Import Conventions

## File Extensions
Always use `.js` extension in import paths, even for TypeScript files:
```typescript
// Correct
import { Foo } from "./services/Foo.js"
import type { Bar } from "@maslow/shared"

// Wrong — will fail at runtime
import { Foo } from "./services/Foo"
import { Foo } from "./services/Foo.ts"
```

## Boundary Rules
- `src/` imports from `src/` and `packages/*`
- `apps/*` imports only from `packages/*`
- `packages/*` imports only from other `packages/*`
- No circular dependencies between services

## Style
- No barrel exports — import from the specific file, not an index
- Group imports: effect → node stdlib → local services → types
- Use `import type` for type-only imports
- Unused imports must be removed (ESLint will catch these)

## Common Packages
- `effect` — `Effect`, `Layer`, `Context`, `Stream`, `Fiber`, `Config`
- `@maslow/shared` — shared types, crypto utilities
- `better-sqlite3` — database (synchronous API)
