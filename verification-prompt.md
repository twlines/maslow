# Verification Prompt

## Card
**Add periodic voice service health pings to Heartbeat**

## Goals
- [x] Create `Heartbeat.ts` service following the Context.Tag + Layer.effect pattern
- [x] Add a cron job that runs every 5 minutes calling `voice.isAvailable()`
- [x] Broadcast result as `{type:"voice.health", stt:boolean, tts:boolean}` to WebSocket clients
- [x] Store last known voice health status in a local variable accessible via `getVoiceHealth()`
- [x] Import Voice into HeartbeatLive as a dependency
- [x] Wire layer composition in index.ts
- [x] Wire broadcast function in AppServer.ts

## Acceptance Criteria
- [x] All goals above are accomplished in the diff
- [x] No breaking changes to existing functionality
- [x] Types pass (`npm run build` exits 0)
- [x] Lint passes (`npm run lint` has 0 errors)
- [x] No secrets, credentials, or .env files in diff
- [x] Changes are scoped to the card — no unrelated modifications

## Verification Steps
1. Run `npm run build` — should compile with zero errors
2. Run `npm run lint` — should produce 0 errors (warnings are pre-existing)
3. Check `src/services/Heartbeat.ts` exists with:
   - `HeartbeatService` interface with `start()`, `stop()`, `getVoiceHealth()`
   - `Heartbeat` Context.Tag class
   - `HeartbeatLive` layer that depends on `Voice`
   - `setHeartbeatBroadcast()` export for AppServer wiring
   - cron job at `*/5 * * * *` calling `voice.isAvailable()`
   - Broadcasts `{type:"voice.health", stt, tts}` to WS clients
4. Check `src/index.ts`:
   - Imports `Heartbeat` and `HeartbeatLive`
   - `HeartbeatLayer` defined with `Layer.provide(Layer2)`
   - `HeartbeatLayer` included in `MainLayer`
   - `heartbeat.start()` called in program after AppServer starts
   - `heartbeat.stop()` called in shutdown sequence
5. Check `src/services/AppServer.ts`:
   - Imports `setHeartbeatBroadcast` from Heartbeat
   - Calls `setHeartbeatBroadcast()` in `start()` wiring it to `wss.clients`

## Context
The Heartbeat service follows the same patterns as `Proactive.ts` (cron-based scheduling) and `AgentOrchestrator.ts` (broadcast wiring via exported setter function). Voice health is checked on startup and then every 5 minutes. The `getVoiceHealth()` method returns the last known status synchronously so other services can include it in their own broadcasts without making an HTTP call.

## Files Changed
- `src/services/Heartbeat.ts` — **NEW** — Heartbeat service with voice health cron job
- `src/services/AppServer.ts` — Import and wire `setHeartbeatBroadcast`
- `src/index.ts` — Import, layer composition, start/stop lifecycle
