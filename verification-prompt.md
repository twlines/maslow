# P2.3: Fix 3 any violations in ClaudeSession

## Goals
Eliminate all `@typescript-eslint/no-explicit-any` warnings in `ClaudeSession.ts` by defining proper types for the Claude CLI JSONL stream output and replacing `any` casts with typed alternatives.

## Acceptance Criteria
- [ ] 0 `any` warnings in `src/services/ClaudeSession.ts`
- [ ] 0 total ESLint warnings in `src/services/ClaudeSession.ts`
- [ ] `npm run type-check` passes for ClaudeSession.ts (no new errors introduced)
- [ ] Claude CLI JSONL stream events are typed via `ClaudeStreamMessage`, `ClaudeStreamContentBlock`, and `ClaudeStreamModelUsage` interfaces
- [ ] No behavioral changes to JSONL parsing logic

## Verification Steps

1. **Lint clean:**
   ```bash
   npx eslint src/services/ClaudeSession.ts
   ```
   Expected: no output (0 warnings, 0 errors)

2. **Type check:**
   ```bash
   npx tsc --noEmit 2>&1 | grep ClaudeSession
   ```
   Expected: no output (0 errors in ClaudeSession.ts)

3. **Review type definitions** (lines 13-42):
   - `ClaudeStreamContentBlock` covers text, tool_use, and tool_result block shapes
   - `ClaudeStreamMessage` covers system, assistant, user, and result message shapes
   - `ClaudeStreamModelUsage` covers token usage statistics

4. **Verify no behavioral changes:**
   - `JSON.parse(line)` results are now typed as `ClaudeStreamMessage`
   - Content block filter/map no longer uses `any` annotations — types flow from `ClaudeStreamContentBlock.content`
   - `modelUsage` is typed as `ClaudeStreamModelUsage | undefined` instead of `any`
   - Guard clauses added for `block.id`, `block.name`, and `block.tool_use_id` to satisfy strict typing

## Files Changed
- `src/services/ClaudeSession.ts` — Added stream types, replaced 3 `any` violations, fixed 2 additional lint warnings
