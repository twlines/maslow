# Verification: Add health endpoint to AppServer

## Card Goals
Add GET /api/health that returns server uptime, heartbeat status, and running agent count.

## Acceptance Criteria

- [ ] GET /api/health returns 200 with JSON response
- [ ] Response includes `uptime` (seconds since process start)
- [ ] Response includes `heartbeat.intervalMs` and `heartbeat.connectedClients`
- [ ] Response includes `agents.running` (filtered count) and `agents.total`
- [ ] Endpoint works without authentication (suitable for load balancers/monitoring)
- [ ] Response follows existing `{ ok: true, data: ... }` envelope pattern
- [ ] Route constant added to `packages/shared/src/api/index.ts`
- [ ] `HealthStatus` type added to `packages/shared/src/types/index.ts`
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint produces no new errors (`npm run lint`)
- [ ] All existing tests pass (`npm run test`)

## Verification Steps

1. Start the server: `npm run dev`
2. Call the health endpoint without auth: `curl http://localhost:3117/api/health`
3. Verify response shape:
   ```json
   {
     "ok": true,
     "data": {
       "status": "ok",
       "uptime": 12.345,
       "timestamp": 1738977600000,
       "heartbeat": {
         "intervalMs": 30000,
         "connectedClients": 0
       },
       "agents": {
         "running": 0,
         "total": 0
       }
     }
   }
   ```
4. Confirm auth is NOT required (no Bearer token needed)
5. Confirm all other endpoints still require auth when configured

## Files Changed

- `src/services/AppServer.ts` — Added health endpoint before auth check
- `packages/shared/src/api/index.ts` — Added `HEALTH` route constant
- `packages/shared/src/types/index.ts` — Added `HealthStatus` interface
- `verification-prompt.md` — This file
