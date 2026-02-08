# Verification: Add heartbeat WS handlers to Talk and Build tabs

## Card Title
Add heartbeat WS handlers to Talk and Build tabs

## Goals
Subscribe to heartbeat.tick, heartbeat.spawned, heartbeat.idle, and heartbeat.error WebSocket messages in both Talk and Build tabs. Show agent activity inline.

## Mapping
The card's "heartbeat" terminology maps to the existing `agent.*` WebSocket messages already broadcast by the server's `AgentOrchestrator`:
- `heartbeat.spawned` -> `agent.spawned`
- `heartbeat.tick` -> `agent.log` (periodic agent output)
- `heartbeat.idle` -> `agent.completed` (agent finished = idle)
- `heartbeat.error` -> `agent.failed`

## Acceptance Criteria

- [ ] `WSCallbacks` interface includes `onAgentSpawned`, `onAgentLog`, `onAgentCompleted`, `onAgentFailed`
- [ ] `ws.onmessage` handler dispatches `agent.spawned`, `agent.log`, `agent.completed`, `agent.failed` to callbacks
- [ ] `addCallbacks()` function allows multiple subscribers without overwriting the primary callbacks
- [ ] **Talk tab**: Agent spawned/completed/failed events appear as inline notifications (ActionNotification with icons)
- [ ] **Talk tab**: Agent log events (orchestrator-level) appear as system messages
- [ ] **Build tab**: Agent events update an `AgentActivityBar` showing running/completed/failed status with pulsing dot
- [ ] **Build tab**: Board auto-refreshes when `agent.completed` or `agent.failed` fires
- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] ESLint passes with no new errors

## Verification Steps

1. **Compile check**: Run `npx tsc --noEmit` — should pass with no errors
2. **Lint check**: Run `npx eslint apps/mobile/services/api.ts apps/mobile/app/\(tabs\)/index.tsx apps/mobile/app/\(tabs\)/build.tsx` — should have only pre-existing warnings, no new errors
3. **Talk tab agent notifications**: Start the server, spawn an agent on a card. Verify the Talk tab shows:
   - "Agent claude started on card abc12345..." (rocket icon, action notification)
   - Orchestrator log lines as system messages
   - "Agent completed card abc12345..." (check-circle icon) or "Agent failed..." (exclamation-circle icon)
4. **Build tab agent activity bar**: Open the Build tab workspace. Verify:
   - `AgentActivityBar` appears below the tab bar when an agent is running
   - Pulsing blue dot for running agents
   - Green dot for completed, red for failed
   - Board automatically refreshes when agent completes/fails
5. **No callback conflicts**: Navigate between Talk and Build tabs. Verify both receive agent events independently (addCallbacks doesn't stomp primary callbacks)

## Files Changed

- `apps/mobile/services/api.ts` — Added agent callbacks to WSCallbacks, added `addCallbacks()`, added agent event dispatch in onmessage/onopen/onclose
- `apps/mobile/app/(tabs)/index.tsx` — Added agent spawned/log/completed/failed handlers showing inline notifications
- `apps/mobile/app/(tabs)/build.tsx` — Added AgentActivityBar component, WebSocket subscription via addCallbacks, auto-refresh on agent completion
