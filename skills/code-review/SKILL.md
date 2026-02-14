---
name: code-review
description: Self-review checklist before committing changes
scope: ollama
domain: code
context-budget: 200
---

# Code Review Checklist

Before outputting your final <edit> blocks, verify each item:

## Type Safety
- [ ] No `any` types introduced
- [ ] All function parameters have explicit types
- [ ] Return types specified on service methods
- [ ] Error channel typed in Effect signatures

## Style
- [ ] No semicolons
- [ ] Double quotes for strings
- [ ] 2-space indentation
- [ ] No barrel exports — import from specific files

## Correctness
- [ ] No unused imports added
- [ ] No unused variables (prefix intentional ones with `_`)
- [ ] All new paths use `.js` extension in imports
- [ ] No circular dependencies between modules

## Minimality
- [ ] Only files that need changes are modified
- [ ] No refactoring beyond what the task requires
- [ ] No new dependencies added unless task demands it
- [ ] No comments added unless logic is non-obvious
