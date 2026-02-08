# Verification: Wire agent and heartbeat broadcast to WebSocket

## Card Title
Wire agent and heartbeat broadcast to WebSocket

## Goals
Wire `setAgentBroadcast` and `setHeartbeatBroadcast` to the WebSocket broadcast function in `AppServer.ts` so that both the AgentOrchestrator and Heartbeat modules can send messages to all connected WebSocket clients.

## Acceptance Criteria

- [ ] `src/services/Heartbeat.ts` exists with `setHeartbeatBroadcast` function matching the `(message: Record<string, unknown>) => void` callback pattern
- [ ] `setHeartbeatBroadcast` is imported in `AppServer.ts` from `./Heartbeat.js`
- [ ] Both `setAgentBroadcast(broadcast)` and `setHeartbeatBroadcast(broadcast)` are called in the `start()` method after WebSocket server creation
- [ ] A shared `broadcast` helper function is extracted (instead of inline closure) and passed to both setters
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with no new errors (`npm run lint`)

## Verification Steps

1. **Type check**: Run `npm run type-check` — should pass with no errors
2. **Lint**: Run `npm run lint` — should have 0 errors (pre-existing warnings are acceptable)
3. **Code review**:
   - Open `src/services/Heartbeat.ts` — verify it exports `setHeartbeatBroadcast` with the correct signature
   - Open `src/services/AppServer.ts` line 17 — verify `setHeartbeatBroadcast` import from `./Heartbeat.js`
   - Open `src/services/AppServer.ts` lines 835-847 — verify the `broadcast` helper and both wiring calls
4. **Runtime** (manual): Start the server with `npm run dev`, connect a WebSocket client to `/ws`, and verify that agent events and heartbeat pings are received

## Files Changed

- `src/services/Heartbeat.ts` — **New file**: broadcast function wiring for heartbeat messages
- `src/services/AppServer.ts` — Added `setHeartbeatBroadcast` import, extracted `broadcast` helper, wired both broadcast setters
