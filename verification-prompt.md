# Verification: Parse and store token usage from agent stream-json output

## Card Goals
Parse stream-json `result` messages from agent stdout in `AgentOrchestrator.ts` to extract token usage and cost data, then persist it via `db.insertTokenUsage()`.

## Acceptance Criteria

- [ ] `token_usage` table is created in AppPersistence schema with columns: id, card_id, project_id, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at
- [ ] `insertTokenUsage` method is added to `AppPersistenceService` interface
- [ ] `insertTokenUsage` implementation uses a prepared statement and `randomUUID()` for the id
- [ ] AgentOrchestrator stdout handler parses each JSONL line as JSON
- [ ] When `message.type === "result"` and `message.modelUsage` exists, token usage is extracted
- [ ] `modelUsage` is extracted as `Object.values(message.modelUsage)[0]` (same pattern as ClaudeSession.ts:210)
- [ ] Token fields mapped correctly: `inputTokens`, `outputTokens`, `cacheReadInputTokens` -> `cacheReadTokens`, `cacheCreationInputTokens` -> `cacheWriteTokens`
- [ ] `total_cost_usd` is stored as `costUsd`
- [ ] `options.cardId`, `options.projectId`, and `options.agent` are passed to `insertTokenUsage`
- [ ] JSON parse errors are silently caught (non-JSON lines are expected)
- [ ] `insertTokenUsage` errors are caught and logged via `addLog`
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint shows no new errors (`npm run lint`)

## Verification Steps

1. Run `npm run type-check` — should pass with no errors
2. Run `npm run lint` — should show no new errors (pre-existing warnings are OK)
3. Review `src/services/AppPersistence.ts`:
   - Search for `token_usage` table in schema section
   - Search for `insertTokenUsage` in prepared statements
   - Search for `insertTokenUsage` in interface and implementation
4. Review `src/services/AgentOrchestrator.ts`:
   - Find the stdout `data` handler (~line 308)
   - Verify JSON parsing with try/catch
   - Verify `message.type === "result"` check
   - Verify `modelUsage` extraction matches ClaudeSession.ts pattern
   - Verify `Effect.runPromise(db.insertTokenUsage(...))` call with `.catch()` error handling

## Files Changed

- `src/services/AppPersistence.ts` — Added `token_usage` table, `insertTokenUsage` prepared statement, interface method, and implementation
- `src/services/AgentOrchestrator.ts` — Added JSONL parsing in stdout handler to detect result messages and store token usage
