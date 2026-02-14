---
name: error-diagnosis
description: Common failure patterns and fixes in the Maslow codebase
scope: both
domain: ops
context-budget: 350
---

# Error Diagnosis

When you encounter an error, match it against these known patterns before attempting a fix.

## Effect Layer Errors

**"Service not found: X"**
- Cause: Missing `Layer.provide()` in the composition chain
- Fix: Find where the consuming layer is composed in `src/index.ts` and add the missing provider
- Example: `OllamaAgentLive` needs `SkillLoader` → `Layer.provide(SkillLoaderLayer)`

**"TypeError: yield* is not a function"**
- Cause: Using `yield*` outside an `Effect.gen(function* () { ... })` block
- Fix: Wrap the generator body in `Effect.gen`

**"Type 'Effect<A, E1>' is not assignable to 'Effect<A, E2>'"**
- Cause: Error channel mismatch between service interface and implementation
- Fix: Align error types — check the interface definition matches the return type

## Build Errors

**"Cannot find module '@maslow/shared'"**
- Cause: Shared package not built — `dist/` is gitignored
- Fix: Run `npm run build --workspace=packages/shared` before the consuming build

**"error TS6305: Output file has not been built from source"**
- Cause: Stale `.tsbuildinfo` cache — `tsc` thinks build is current but `dist/` is missing
- Fix: Delete `*.tsbuildinfo` and rebuild

## Runtime Errors

**"EADDRINUSE :::3117"**
- Cause: Previous server process still holding the port
- Fix: `lsof -ti :3117 | xargs kill -9` then restart

**"ENOENT: no such file or directory" on worktree path**
- Cause: Stale worktree reference — branch was deleted but worktree entry remains
- Fix: `git worktree remove --force .worktrees/<id>`

**Chatterbox TTS hangs indefinitely**
- Cause: MPS device loading — PyTorch MPS backend freezes on model load
- Fix: Always start with `DEVICE=cpu` — never use MPS for Chatterbox

**"SQLITE_ERROR: no such table"**
- Cause: Database file path wrong or schema not initialized
- Fix: Check `Config.database.path` points to the right `.db` file, verify `CREATE TABLE IF NOT EXISTS` runs at startup

## CI Failures

**"Peer dependency conflict: eslint"**
- Cause: eslint major version doesn't match typescript-eslint peer range
- Fix: Check `typescript-eslint` peer requirements — currently needs `eslint ^8.57.0 || ^9.0.0`

**"npm ERR! Missing: @maslow/shared"**
- Cause: CI runs `npm ci` but shared package needs building first
- Fix: Add `npm run build --workspace=packages/shared` step before lint/type-check
