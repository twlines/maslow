# Verification: Add GET /api/usage endpoint for cost summaries

## Card Title
Add GET /api/usage endpoint for cost summaries

## Goals
Add a REST endpoint that returns aggregated token usage and cost data, grouped by project. Provide total costs, per-project breakdowns, and recent expensive messages.

## Acceptance Criteria

- [ ] `GET /api/usage` returns a `{ ok: true, data: UsageSummary }` response
- [ ] `GET /api/usage?project_id=X` filters to a specific project
- [ ] `GET /api/usage?days=30` controls the time window (default 30 days)
- [ ] Response includes `total: { inputTokens, outputTokens, costUsd }`
- [ ] Response includes `byProject: [{ projectId, projectName, totalCost, cardCount }]`
- [ ] Response includes `recentMessages: [{ messageId, projectId, cost, inputTokens, outputTokens, timestamp }]`
- [ ] `getUsageSummary(projectId?, days?)` method exists on `AppPersistenceService` interface
- [ ] `UsageSummary` interface is exported from `AppPersistence.ts`
- [ ] `USAGE` route constant added to shared API routes
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with no new errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Verification Steps

1. **Type check**: Run `npm run type-check` -- should pass with zero errors
2. **Lint**: Run `npm run lint` -- should have 0 errors (warnings are pre-existing)
3. **Build**: Run `npm run build` -- should compile cleanly
4. **Manual test** (requires running server):
   - `curl http://localhost:3117/api/usage` -- returns usage summary for last 30 days
   - `curl http://localhost:3117/api/usage?days=7` -- returns last 7 days
   - `curl "http://localhost:3117/api/usage?project_id=SOME_ID&days=90"` -- filtered by project
5. **Verify response shape**: Check that response matches `UsageSummary` interface

## Design Notes

The card assumed a `token_usage` table exists, but cost data is actually stored in the `messages.metadata` JSON column (as `{ tokens: { input, output }, cost }`). The implementation queries messages directly, parsing metadata to aggregate costs. This matches the existing data flow where Claude CLI costs are captured and stored in message metadata during WebSocket chat/voice sessions.

The `cardCount` field in `byProject` represents the number of assistant messages with cost data for that project (since there's no card-level cost tracking in the current schema).

## Files Changed

- `src/services/AppPersistence.ts` -- Added `UsageSummary` interface, `getUsageSummary` method to service interface and implementation
- `src/services/AppServer.ts` -- Added `GET /api/usage` endpoint handler
- `packages/shared/src/api/index.ts` -- Added `USAGE` route constant
