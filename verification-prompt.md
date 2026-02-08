# D4: Write SessionManager + AgentOrchestrator tests

## Goals
- Comprehensive unit tests for SessionManager service
- Comprehensive unit tests for AgentOrchestrator service
- Full mock coverage for all service dependencies
- Test all critical flows: message routing, continuation, voice, workspace actions, concurrency, worktree lifecycle, prompt assembly

## Acceptance Criteria

### SessionManager Tests (25 tests)
- [x] Message routing: text messages routed to Claude
- [x] Message routing: session resumption with existing claudeSessionId
- [x] Message routing: `/restart_claude` command handling
- [x] Message routing: task brief (TASK: and Brief: prefixes) routing to Heartbeat
- [x] Message routing: caption fallback when text absent
- [x] Message routing: default prompt for image-only messages
- [x] Message routing: photo download (largest photo selected)
- [x] Voice handling: transcription and forwarding to Claude
- [x] Voice handling: voice response synthesis for voice input
- [x] Voice handling: graceful degradation on transcription failure
- [x] Continuation: context warning at 80%+ usage
- [x] Continuation: auto-handoff at 50% context usage
- [x] Continuation: user "continue" trigger after warning
- [x] Continuation: explicit handleContinuation call
- [x] Continuation: handleContinuation with no active session
- [x] Workspace actions: create_card parsing and execution
- [x] Workspace actions: move_card with board search
- [x] Workspace actions: log_decision
- [x] Workspace actions: add_assumption
- [x] Workspace actions: update_state
- [x] Workspace actions: multiple actions in single response
- [x] Event processing: tool_call events
- [x] Event processing: error events
- [x] Event processing: sessionId update from Claude

### AgentOrchestrator Tests (28 tests)
- [x] Spawn: successful agent spawn
- [x] Concurrency: reject at max 3 global concurrent agents
- [x] Concurrency: reject when project already has running agent (1 per project)
- [x] Concurrency: reject when card already has running agent
- [x] Concurrency: reject when card not found
- [x] Worktree: git worktree creation with correct branch name
- [x] Worktree: fallback to existing branch
- [x] Worktree: spawn in worktree directory
- [x] Worktree: ANTHROPIC_API_KEY stripped from env
- [x] Command: correct claude CLI args
- [x] Command: correct codex CLI args
- [x] Command: correct gemini CLI args
- [x] Prompt: identity section included
- [x] Prompt: card title and description included
- [x] Prompt: deep research protocol included
- [x] Prompt: completion checklist included
- [x] Prompt: project context included
- [x] Prompt: steering corrections included
- [x] Prompt: previous context snapshot included
- [x] Lifecycle: getRunningAgents tracking
- [x] Lifecycle: getAgentLogs returns log lines
- [x] Lifecycle: empty logs for unknown card
- [x] Lifecycle: stopAgent with context save
- [x] Lifecycle: stopAgent fails for nonexistent agent
- [x] Shutdown: graceful with no running agents
- [x] Shutdown: graceful shutdown of running agents
- [x] Branch naming: slugification
- [x] Branch naming: long title truncation

## Verification Steps

1. Run SessionManager tests:
   ```bash
   npx vitest run src/__tests__/services/SessionManager.test.ts --reporter=verbose
   ```
   Expected: 25 tests pass

2. Run AgentOrchestrator tests:
   ```bash
   npx vitest run src/__tests__/services/AgentOrchestrator.test.ts --reporter=verbose
   ```
   Expected: 28 tests pass

3. Run full test suite:
   ```bash
   npx vitest run
   ```
   Expected: All tests pass (121+ passed, some skipped)

4. Lint check:
   ```bash
   npx eslint src/__tests__/services/SessionManager.test.ts src/__tests__/services/AgentOrchestrator.test.ts
   ```
   Expected: 0 errors (warnings for `any` casts in mocks are acceptable)

## Files Changed
- `src/__tests__/services/SessionManager.test.ts` (new - 25 tests)
- `src/__tests__/services/AgentOrchestrator.test.ts` (new - 28 tests)
- `verification-prompt.md` (new)
