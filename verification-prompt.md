# Verification: Add WebSocket auth and project-scoped subscriptions

## Card Title
Add WebSocket auth and project-scoped subscriptions

## Goals
1. Authenticate WebSocket connections via `?token=` query param (in addition to existing header auth)
2. Support `{type:"subscribe", projectId:"xxx"}` client messages with per-client subscription tracking
3. Project-scoped broadcast filtering: events with `projectId` only go to subscribed clients

## Acceptance Criteria

- [ ] WebSocket connections with `?token=<valid>` query param are accepted
- [ ] WebSocket connections with invalid/missing token are closed with code 4001 (when auth is configured)
- [ ] Dev mode (no `APP_SERVER_TOKEN` set) still allows all connections
- [ ] Clients can send `{type:"subscribe", projectId:"xxx"}` to subscribe to a project
- [ ] Client subscriptions are tracked per-connection in a Map
- [ ] Client subscriptions are cleaned up on disconnect
- [ ] Agent broadcast messages (agent.log, agent.spawned, agent.completed, agent.failed) include `projectId`
- [ ] Broadcast messages with a `projectId` are only sent to clients subscribed to that project
- [ ] Broadcast messages without a `projectId` are sent to all connected clients
- [ ] `WSClientMessage` type in shared package includes the `subscribe` message variant
- [ ] Build passes (`npm run build`)
- [ ] Lint passes with no new errors (`npm run lint`)

## Verification Steps

### 1. Auth — query param
```bash
# Start server with APP_SERVER_TOKEN=test123
# Connect with valid token:
wscat -c "ws://localhost:3117/ws?token=test123"
# Should connect successfully and receive {"type":"presence","state":"idle"}

# Connect with invalid token:
wscat -c "ws://localhost:3117/ws?token=wrong"
# Should be closed with code 4001
```

### 2. Auth — dev mode
```bash
# Start server WITHOUT APP_SERVER_TOKEN (or set to empty)
wscat -c "ws://localhost:3117/ws"
# Should connect without any token
```

### 3. Subscribe messages
```bash
# After connecting, send:
{"type":"subscribe","projectId":"project-123"}
# Should see server log: "[AppServer] Client subscribed to project project-123"
```

### 4. Project-scoped broadcast
```bash
# Connect two clients:
# Client A: subscribes to project-123
# Client B: subscribes to project-456
# Trigger an agent event for project-123
# Only Client A should receive the agent.log/agent.spawned events
```

### 5. Build & Lint
```bash
npm run build   # Should compile without errors
npm run lint     # Should have 0 errors (warnings are pre-existing)
```

## Files Changed

| File | Changes |
|------|---------|
| `src/services/AppServer.ts` | Updated `authenticate()` to parse `?token=` query param; added `clientSubscriptions` Map; added subscribe message handler; updated broadcast to filter by projectId; cleanup subscriptions on disconnect |
| `src/services/AgentOrchestrator.ts` | Added `projectId` field to all 5 broadcast calls (agent.log, agent.spawned, agent.completed, agent.failed x2) |
| `packages/shared/src/types/index.ts` | Added `{ type: "subscribe"; projectId: string }` to `WSClientMessage` union type |
