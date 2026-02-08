# Verification: Delete AutonomousWorker.ts and all references

## Card Title
Delete AutonomousWorker.ts and all references

## Goals
Remove the AutonomousWorker service entirely from the codebase, including all imports, type references, layer composition entries, and documentation references.

## Acceptance Criteria
- [ ] `src/services/AutonomousWorker.ts` no longer exists
- [ ] No `.ts` file in `src/` references `AutonomousWorker`
- [ ] `src/index.ts` layer composition no longer includes AutonomousWorkerLayer
- [ ] `src/index.ts` program no longer starts/stops AutonomousWorker
- [ ] `src/services/SessionManager.ts` no longer imports or uses AutonomousWorker
- [ ] `SessionManager.ts` no longer handles `TASK:` / `Brief:` message prefixes (dead code without AutonomousWorker)
- [ ] Documentation files updated to remove AutonomousWorker from layer diagrams and file trees
- [ ] `npm run build` compiles without errors

## Verification Steps
1. `ls src/services/AutonomousWorker.ts` should fail (file deleted)
2. `grep -r "AutonomousWorker" src/` should return no results
3. `npm run build` should succeed with zero errors
4. `grep -r "AutonomousWorker" CLAUDE.md SETUP.md DEPLOYMENT_SUMMARY.md PLAN-HEARTBEAT-KANBAN-AGENTS.md .claude/skills/effect-service/SKILL.md` should return no results

## Files Changed
- `src/services/AutonomousWorker.ts` — **deleted**
- `src/index.ts` — removed import, layer definition, layer composition, program usage (start/stop)
- `src/services/SessionManager.ts` — removed import, dependency injection, TASK/Brief handling block
- `CLAUDE.md` — updated layer composition diagram
- `PLAN-HEARTBEAT-KANBAN-AGENTS.md` — updated layer composition diagram
- `DEPLOYMENT_SUMMARY.md` — removed from file tree
- `SETUP.md` — removed from file tree
- `.claude/skills/effect-service/SKILL.md` — updated layer composition diagram
