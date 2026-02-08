# Verification: Wire action parser into SessionManager text events

## Card Title
Wire action parser into SessionManager text events

## Goals
Wire `parseWorkspaceActions()` into the Telegram message flow so that Claude's `:::action` blocks
(create_card, move_card, log_decision, add_assumption, update_state) are executed via the Kanban
and ThinkingPartner services when processing responses through SessionManager.

## Acceptance Criteria

- [ ] `parseWorkspaceActions` and `WorkspaceAction` are exported from `AppServer.ts`
- [ ] `AppServer.ts` internal `parseActions` closure delegates to the exported function (no duplication)
- [ ] `SessionManager.ts` imports `parseWorkspaceActions` and `WorkspaceAction` from `AppServer.ts`
- [ ] `SessionManager.ts` imports and depends on `Kanban` and `ThinkingPartner` services
- [ ] In `processClaudeEvents` result case, `parseWorkspaceActions(fullResponseText)` is called
- [ ] `create_card` actions call `kanban.createCard(projectId, title, description, column)`
- [ ] `move_card` actions use `kanban.getBoard(projectId)` to find card by title substring, then `kanban.moveCard(id, column)`
- [ ] `log_decision` actions call `thinkingPartner.logDecision(projectId, { title, description, alternatives, reasoning, tradeoffs })`
- [ ] `add_assumption` actions call `thinkingPartner.addAssumption(projectId, assumption)`
- [ ] `update_state` actions call `thinkingPartner.updateStateSummary(projectId, summary)`
- [ ] Each action is wrapped in `Effect.catchAll` for graceful failure (no crash on FK or data errors)
- [ ] `index.ts` layer composition provides `KanbanLayer` and `ThinkingPartnerLayer` to `SessionManagerLayer`
- [ ] TypeScript compiles cleanly (`npm run type-check`)
- [ ] ESLint passes with zero errors (`npm run lint --quiet`)

## Verification Steps

1. **Compile check**: `npm run type-check` should pass with no errors
2. **Lint check**: `npm run lint -- --quiet` should pass with no errors
3. **Code review**: Verify the `case "result":` block in `processClaudeEvents` calls `parseWorkspaceActions(fullResponseText)` after voice synthesis and before session update
4. **Action routing**: Confirm each action type maps to the correct service method with proper argument defaulting
5. **Error isolation**: Verify each action is individually wrapped in `Effect.catchAll` so one failing action doesn't block others
6. **Layer composition**: Confirm `SessionManagerLayer` in `index.ts` includes `KanbanLayer` and `ThinkingPartnerLayer`
7. **No duplication**: Verify `AppServer.ts` internal `parseActions` now delegates to `parseWorkspaceActions`

## Files Changed

- `src/services/AppServer.ts` — exported `WorkspaceAction` interface and `parseWorkspaceActions` function; internal `parseActions` now delegates
- `src/services/SessionManager.ts` — added Kanban/ThinkingPartner deps, `executeWorkspaceActions` helper, action parsing in result case
- `src/index.ts` — updated `SessionManagerLayer` to provide `KanbanLayer` and `ThinkingPartnerLayer`
