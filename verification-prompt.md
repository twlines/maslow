# D2: Extract AgentOrchestrator sub-modules

## Goals

Extract the monolithic `AgentOrchestrator.ts` (699 lines) into a modular `src/services/agent/` directory with dedicated sub-modules for prompt building, process management, and git worktree operations. Reduce `spawnAgent` from ~300 lines of inline logic to ~50 lines of orchestration calling sub-modules.

## Acceptance Criteria

- [x] `src/services/agent/prompt-builder.ts` exists with `buildAgentPrompt` function and `DEEP_RESEARCH_PROTOCOL` constant
- [x] `src/services/agent/process-manager.ts` exists with `buildAgentCommand`, `spawnAgentProcess` (spawn, stdout/stderr parsing, timeout, cleanup)
- [x] `src/services/agent/worktree.ts` exists with `createWorktree`, `removeWorktree`, `generateBranchName`, `worktreePath`, `slugify`
- [x] `src/services/agent/types.ts` exists with shared types (`AgentProcess`, `AgentLogEvent`, `ProcessManagerDeps`)
- [x] `src/services/agent/index.ts` facade re-exports `AgentOrchestrator`, `AgentOrchestratorLive`, `setAgentBroadcast`, and all types
- [x] Old monolithic `src/services/AgentOrchestrator.ts` is deleted
- [x] All consumers (`src/index.ts`, `Heartbeat.ts`, `AppServer.ts`) updated to import from `./agent/index.js`
- [x] `spawnAgent` in index.ts is ~50 lines of orchestration (validation, fetch, prompt, worktree, spawn, register)
- [x] No new TypeScript errors introduced (all errors in type-check are pre-existing)
- [x] Lint passes on all agent sub-module files

## Verification Steps

1. **Type-check**: Run `npx tsc --noEmit` — verify no new errors beyond the pre-existing ones in `src/index.ts` (duplicate Heartbeat import) and `src/services/AppServer.ts` (missing AppPersistence members)
2. **Lint**: Run `npx eslint src/services/agent/` — should pass clean
3. **Import resolution**: Verify `src/index.ts:26` imports from `"./services/agent/index.js"`, `Heartbeat.ts:16` imports from `"./agent/index.js"`, `AppServer.ts:22` imports from `"./agent/index.js"`
4. **Behavioral equivalence**: The refactoring is purely structural — no logic changes. The same functions are called in the same order with the same arguments. Verify by diffing the old AgentOrchestrator.ts against the combined new files.
5. **No circular imports**: `types.ts` has no imports from sibling sub-modules. `process-manager.ts` imports from `types.ts` and `worktree.ts`. `prompt-builder.ts` imports only from parent services. `index.ts` imports from all sub-modules.

## Files Changed

- `src/services/AgentOrchestrator.ts` — **deleted** (replaced by agent/ directory)
- `src/services/agent/types.ts` — **new** (shared types: AgentProcess, AgentLogEvent, ProcessManagerDeps)
- `src/services/agent/prompt-builder.ts` — **new** (buildAgentPrompt, DEEP_RESEARCH_PROTOCOL)
- `src/services/agent/process-manager.ts` — **new** (buildAgentCommand, spawnAgentProcess)
- `src/services/agent/worktree.ts` — **new** (createWorktree, removeWorktree, generateBranchName, worktreePath, slugify)
- `src/services/agent/index.ts` — **new** (facade: AgentOrchestrator service + Layer + re-exports)
- `src/index.ts` — **modified** (import path updated)
- `src/services/Heartbeat.ts` — **modified** (import path updated)
- `src/services/AppServer.ts` — **modified** (import path updated)
