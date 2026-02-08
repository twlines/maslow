# Verification: Add WebSocket upgrade handler to AppServer

## Card Title
Add WebSocket upgrade handler to AppServer

## Goals
Refactor AppServer.ts to use explicit HTTP upgrade handling for WebSocket connections instead of the implicit `WebSocketServer({ server })` pattern. Add a local `Set` of connected clients and a `broadcast()` function for sending messages to all clients.

## Acceptance Criteria

- [ ] `WebSocketServer` created with `{ noServer: true }` instead of `{ server: httpServer, path: "/ws" }`
- [ ] HTTP server listens for `"upgrade"` event explicitly
- [ ] Upgrade handler only accepts connections on `/ws` path; destroys socket for other paths
- [ ] `wss.handleUpgrade()` called to complete the WebSocket handshake
- [ ] Connected clients stored in a local `Set`
- [ ] Clients added to Set on `"connection"` event, removed on `"close"` event
- [ ] Local `broadcast(message)` function that JSON-serializes and sends to all OPEN clients
- [ ] Agent broadcast (`setAgentBroadcast`) wired through the local `broadcast()` function
- [ ] Heartbeat uses local `clients` Set instead of `wss.clients`
- [ ] Finalizer and `stop()` method use local `clients` Set for cleanup
- [ ] No new exports added (broadcast and clients are internal to AppServer)
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with no new errors (`npm run lint`)

## Verification Steps

1. **Type check**: `npm run type-check` should pass with no errors
2. **Lint**: `npm run lint` should show 0 errors (pre-existing warnings are acceptable)
3. **Code review**: Open `src/services/AppServer.ts` and verify:
   - Line ~119: `const clients = new Set<any>()` exists
   - Line ~122-129: `broadcast()` function defined
   - Line ~848: `new WebSocketServer({ noServer: true })`
   - Line ~850-860: `httpServer.on("upgrade", ...)` handler with `/ws` path check
   - Line ~863-865: `setAgentBroadcast` calls `broadcast()`
   - Line ~1096: `clients.add(ws)` in connection handler
   - Line ~1411: `clients.delete(ws)` in close handler
4. **Manual test** (optional): Start dev server (`npm run dev`), connect a WebSocket client to `ws://localhost:3117/ws`, verify connection is accepted. Try connecting to `ws://localhost:3117/other` and verify it's rejected.

## Files Changed

- `src/services/AppServer.ts` — Refactored WebSocket initialization to use explicit upgrade handler, added clients Set and broadcast function
