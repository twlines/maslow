# B13: Create AppPersistence Legacy Facade

## Goals
Create `src/services/persistence/index.ts` that re-exports the AppPersistence tag and AppPersistenceLive layer. Compose all extracted repositories into the same 37-method interface. Zero breaking changes. Mark facade as deprecated (1 release cycle). Update `src/index.ts` layer composition to use new persistence module.

## Acceptance Criteria

- [ ] `src/services/persistence/index.ts` exists and re-exports `AppPersistence`, `AppPersistenceLive`, `AppPersistenceService`, and all domain types
- [ ] All re-exports are marked with `@deprecated` JSDoc annotations
- [ ] `src/index.ts` imports `AppPersistence` and `AppPersistenceLive` from `./services/persistence/index.js`
- [ ] All existing imports from `./AppPersistence.js` in other service files continue to work (zero breaking changes)
- [ ] No new TypeScript errors introduced (pre-existing errors are documented)
- [ ] No new ESLint errors or warnings introduced
- [ ] The persistence facade re-exports all 13 types: `AppPersistenceService`, `AppMessage`, `AppProject`, `AppProjectDocument`, `AppDecision`, `AppKanbanCard`, `AppConversation`, `UsageSummary`, `SteeringCorrection`, `TokenUsage`, `AgentType`, `AgentStatus`, `CorrectionDomain`, `CorrectionSource`

## Verification Steps

1. **Check facade file exists and contents:**
   ```bash
   cat src/services/persistence/index.ts
   ```
   Verify it re-exports `AppPersistence`, `AppPersistenceLive`, and all types from `../AppPersistence.js`.

2. **Check deprecation annotations:**
   ```bash
   grep -n "@deprecated" src/services/persistence/index.ts
   ```
   Should show deprecation markers on the module docblock, `AppPersistence`, and `AppPersistenceLive`.

3. **Check index.ts import path:**
   ```bash
   grep "persistence" src/index.ts
   ```
   Should show import from `./services/persistence/index.js`.

4. **Verify zero new type errors:**
   ```bash
   npm run type-check 2>&1 | wc -l
   ```
   Error count should match baseline (11 pre-existing errors in index.ts and AppServer.ts).

5. **Verify zero new lint issues:**
   ```bash
   npx eslint src/services/persistence/index.ts
   ```
   Should produce no output (clean).

6. **Verify existing imports still resolve:**
   ```bash
   grep -r 'from.*AppPersistence' src/services/ --include="*.ts" | grep -v persistence/
   ```
   All existing `./AppPersistence.js` imports in consumer files are unchanged and continue to resolve.

## Files Changed

- `src/services/persistence/index.ts` (NEW) - Legacy facade re-exporting AppPersistence tag, layer, and all types
- `src/index.ts` (MODIFIED) - Updated AppPersistence import to use new persistence module path

## Pre-existing Issues (Not Introduced by This Change)

- `AuditLogFilters` imported from `AppPersistence.js` in `AppServer.ts:18` but not defined there
- `search`, `getAuditLog`, `backupDatabase` used in `AppServer.ts` but not on `AppPersistenceService` interface
- Duplicate `Heartbeat`/`HeartbeatLive` import in `src/index.ts` (lines 19, 21)
- Duplicate `HeartbeatLayer` variable declaration in `src/index.ts` (lines 46, 83)
