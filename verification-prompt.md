# D3: Replace module-level broadcast mutable state

## Goals

Replace `setAgentBroadcast` and `setHeartbeatBroadcast` module-level mutable state setters with a proper Effect service (`Broadcast`), eliminating temporal coupling and import cycle risk.

## Acceptance Criteria

- [ ] No module-level `let broadcast` variables in AgentOrchestrator.ts or Heartbeat.ts
- [ ] No exported `setAgentBroadcast` or `setHeartbeatBroadcast` functions
- [ ] New `Broadcast` service follows Context.Tag + Layer pattern
- [ ] `AgentOrchestrator` and `Heartbeat` depend on `Broadcast` via Effect dependency injection
- [ ] `AppServer` wires broadcast handlers through the `Broadcast` service (not module-level setters)
- [ ] Dead code removed (duplicate `setHeartbeatBroadcast` call at former line 1238-1240)
- [ ] Duplicate `HeartbeatLayer` and `Heartbeat` import in index.ts fixed
- [ ] No new lint errors introduced
- [ ] No new type-check errors introduced (pre-existing errors unchanged)

## Verification Steps

1. **Search for old pattern**: `grep -r "setAgentBroadcast\|setHeartbeatBroadcast" src/` should return no results
2. **Search for module-level mutable broadcast state**: `grep -n "let broadcast" src/services/AgentOrchestrator.ts src/services/Heartbeat.ts` should return no results
3. **Verify Broadcast service exists**: `cat src/services/Broadcast.ts` should show Context.Tag + Layer pattern
4. **Type-check**: `npx tsc --noEmit` should show only pre-existing errors (AppPersistence members, MainLayer type)
5. **Lint**: `npx eslint src/services/Broadcast.ts src/services/AgentOrchestrator.ts src/services/Heartbeat.ts src/services/AppServer.ts src/index.ts` should show 0 errors
6. **Verify layer wiring**: Check that `BroadcastLayer` is provided to `AgentOrchestratorLayer`, `HeartbeatLayer`, and `AppServerLayer` in `src/index.ts`
7. **Verify broadcast call sites unchanged**: All `broadcast({...})` calls in AgentOrchestrator.ts and Heartbeat.ts should still exist and work identically (now sourced from service destructuring)

## Files Changed

- `src/services/Broadcast.ts` (NEW) — Broadcast service with Context.Tag + Layer
- `src/services/AgentOrchestrator.ts` — Removed module-level state, added Broadcast dependency
- `src/services/Heartbeat.ts` — Removed module-level state, added Broadcast dependency
- `src/services/AppServer.ts` — Replaced setter imports with Broadcast service; removed dead code
- `src/index.ts` — Added BroadcastLayer to composition; fixed duplicate imports/declarations
