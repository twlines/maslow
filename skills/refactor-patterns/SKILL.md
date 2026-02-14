---
name: refactor-patterns
description: Safe refactoring patterns for moves, renames, and extractions
scope: both
domain: code
context-budget: 250
---

# Refactor Patterns

## Renaming a Function or Variable

1. Find ALL references — not just the definition
   - Check imports across `src/`, `apps/`, `packages/`
   - Check string references in tests, comments, and SQL
   - Check re-exports if the symbol is public
2. Rename at the definition site
3. Update every import and usage site
4. If exported from a package, update the package's type exports

## Moving a Function to Another File

1. Cut the function and its type dependencies from the source file
2. Paste into the target file with correct imports
3. Add an export in the target file
4. Update ALL import paths in consuming files — remember `.js` extensions
5. Remove the old import from the source file's exports if it was exported
6. Do NOT leave a re-export stub in the old location — clean break

## Extracting a Service

When splitting a large service into two:
1. Define the new interface and `Context.Tag` in a new file
2. Move the relevant methods from the old service
3. Add the new service as a dependency where the old one was used
4. Update the layer composition in `src/index.ts`
5. Update tests to provide the new layer

## Boundary Check After Any Refactor

After every move or rename, verify:
- [ ] No `src/` file imports from `apps/`
- [ ] No `apps/` file imports from `src/`
- [ ] No `packages/` file imports from `src/` or `apps/`
- [ ] All import paths use `.js` extension
- [ ] No circular imports introduced (A→B→A)
- [ ] `npm run type-check` passes
