---
description: Review the current diff against Maslow codebase standards before pushing
---

# Diff Review

Review all staged and unstaged changes against Maslow's engineering standards. This catches what linters miss.

## Step 1: Get the Diff

```bash
# Show all changes (staged + unstaged) vs the base branch
git diff main...HEAD --unified=5
```

If no commits yet, use:
```bash
git diff --unified=5
```

## Step 2: Check Each Changed File

For every file in the diff, verify:

### Import Rules
- [ ] All import paths use `.js` extension
- [ ] No barrel imports (from `./index.js`)
- [ ] Boundary rules: `apps/` only imports `packages/*`, `src/` doesn't import `apps/`
- [ ] `import type` used for type-only imports
- [ ] No unused imports added

### Effect-TS Patterns
- [ ] Services use `Context.Tag` + `Layer.effect` pattern
- [ ] `better-sqlite3` wrapped in `Effect.sync()`, not `Effect.tryPromise()`
- [ ] Error channels specified: `Effect.Effect<A, E>`, not `Effect.Effect<A>`
- [ ] No `await` inside `Effect.gen` generators
- [ ] `Layer.scoped` + `Effect.addFinalizer` for resource-holding services

### TypeScript Strictness
- [ ] No `any` types introduced
- [ ] No `as` casts without structural proof
- [ ] No `// @ts-ignore` or `// @ts-expect-error` added
- [ ] Unused variables prefixed with `_`

### SQL Safety
- [ ] All queries use prepared statements (in `stmts` object)
- [ ] No string concatenation in SQL
- [ ] Migrations use `pragma("table_info")` existence checks
- [ ] `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`

### Security
- [ ] No secrets, tokens, or API keys in code
- [ ] No `console.log` with sensitive data
- [ ] Input validation on all new API endpoints
- [ ] Path traversal check on any file operations

### Code Hygiene
- [ ] No `console.log` debug statements left in
- [ ] No commented-out code blocks
- [ ] No TODO/FIXME without a linked kanban card
- [ ] Changes stay under 400 lines (warn if over)

## Step 3: Report

```
## Diff Review

### Files Changed: 5

| File | Lines | Issues |
|------|-------|--------|
| src/services/Foo.ts | +42 -8 | 1 warning |
| src/services/Bar.ts | +15 -3 | clean |

### Issues Found

#### BLOCK (must fix before push)
- `src/services/Foo.ts:28` — `any` type on parameter `data`
- `src/services/Baz.ts:55` — Missing `.js` extension on import

#### WARN (should fix)
- `src/services/Foo.ts:35` — `console.log` left in (debug?)

#### INFO
- Total diff: 312 lines (under 400 limit)
- 2 new imports, 0 unused

### Verdict: BLOCK — fix 2 issues before pushing
```

## Step 4: Offer Fixes

For each BLOCK issue, offer to fix it automatically. Apply fixes and re-run the review if the user approves.
