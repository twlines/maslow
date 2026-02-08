# Verification Prompt

## Card
Wire heartbeat status into Build tab

## Goals
- [ ] Show heartbeat tick history (tick count) in the Build tab header
- [ ] Show running agents count in the Build tab header
- [ ] Show next tick countdown in the Build tab header
- [ ] Show connection status (connected/reconnecting) in the Build tab header
- [ ] Show server uptime in the Build tab header

## Acceptance Criteria
- [ ] All goals above are accomplished in the diff
- [ ] No breaking changes to existing functionality
- [ ] Types pass (`npm run type-check`)
- [ ] Lint passes (`npm run lint`) with no new errors
- [ ] Tests pass (`npm run test`)
- [ ] No secrets, credentials, or .env files in diff
- [ ] Changes are scoped to the card -- no unrelated modifications
- [ ] HeartbeatStatusBar component renders in both project list and workspace views
- [ ] Server broadcasts `system.heartbeat` messages every 30 seconds alongside existing pings
- [ ] Client handles new WebSocket message types (system.heartbeat, agent.spawned, agent.completed, agent.failed)
- [ ] Countdown timer resets on each heartbeat tick and counts down from 30

## Verification Steps
1. Run `npm run type-check` -- should pass with no errors
2. Run `npm run lint` -- should pass with no new errors (only pre-existing warnings)
3. Run `npm run test` -- all 52 tests should pass (8 skipped)
4. Start the server with `npm run dev` and open the mobile app
5. Navigate to the Build tab -- the HeartbeatStatusBar should appear at the top
6. Verify the status bar shows: green dot + "Connected", heartbeat icon + tick count, terminal icon + agent count, clock icon + countdown, uptime
7. Wait 30 seconds -- the tick count should increment by 1 and the countdown should reset to 30
8. Select a project -- the HeartbeatStatusBar should still be visible above the workspace header
9. Stop the server -- the status bar should show red dot + "Reconnecting..." and heartbeat details should disappear

## Context
The heartbeat system already existed in AppServer.ts (ping/pong every 30s for connection liveness). This change adds a new `system.heartbeat` WebSocket message that piggybacks on the existing heartbeat interval to broadcast server status (tick count, running agent count, uptime) to connected clients. The Build tab now displays this information in a compact status bar at the top of the screen.

The implementation follows existing patterns:
- WSCallbacks pattern from api.ts (same as Talk tab's onOpen/onClose)
- Status bar UI pattern from Talk tab's connection indicator (index.tsx:736-739)
- Agent data from AgentOrchestrator.getRunningAgents() which already strips non-serializable fields

## Files Changed
- `packages/shared/src/types/index.ts` -- Added `system.heartbeat` to WSServerMessage union type
- `src/services/AppServer.ts` -- Added tick counter, server start time, and system.heartbeat broadcast in heartbeat interval
- `apps/mobile/services/api.ts` -- Added HeartbeatStatus/AgentEvent types, WSCallbacks handlers, agent REST method, switch cases for new message types
- `apps/mobile/app/(tabs)/build.tsx` -- Added HeartbeatStatusBar component with countdown timer, wired up WebSocket callbacks in BuildScreen, added agent fields to Card interface
