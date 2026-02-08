# Maslow Session Handoff — 2026-02-08

## What Maslow Is

Telegram-Claude bridge bot + Expo web UI. Users message via Telegram or `localhost:8081`, the server spawns Claude CLI subagents to do work. It has a kanban board where tasks are tracked, and a "Heartbeat" service that auto-picks up backlog cards every 10 minutes.

## Architecture

- **Bot process**: runs as launchd service `com.trevor.telegram-claude`
- **Plist**: `~/Library/LaunchAgents/com.trevor.telegram-claude.plist`
- **Logs**: `/tmp/telegram-claude.log` (stdout), `/tmp/telegram-claude.error.log` (stderr)
- **Ports**: Expo web UI on `:8081`, AppServer (HTTP/WS API) on `:3117`
- **Repo**: `~/maslow` (symlinked from `~/Maslow` — macOS case-insensitive)
- **DB**: `data/app.db` (SQLite)
- **Feature commit**: `0a0f3ba` — all services exist at this commit

## CRITICAL: Git Repo State Is Broken

`.git/HEAD` points to `ref: refs/heads/fix/agent-orchestrator-spawn` but that branch ref may not exist. The repo may also have stale references to deleted agent branches.

### Fix git FIRST:
```bash
cd /Users/mazlow/maslow
mkdir -p .git/refs/heads/fix
echo "0a0f3bac4a3e2b116b6a80c72416c2b32c8e9a39" > .git/refs/heads/fix/agent-orchestrator-spawn
git worktree prune
rm -rf .worktrees/
git branch --list "agent/*" | xargs -I{} git branch -D {} 2>/dev/null
git branch -D test-agent 2>/dev/null
git status
```

After this, you should be on `fix/agent-orchestrator-spawn` at commit `0a0f3ba` with uncommitted changes.

## What's Been Fixed (in source, not committed)

All four agent spawn bugs have been fixed in `src/services/AgentOrchestrator.ts`:

| Bug | Before | After |
|-----|--------|-------|
| Missing `--verbose` | Not in args | Added to claude args |
| Invalid `--cwd` flag | `"--cwd", cwd` in args | Removed (cwd passed via spawn options) |
| stdin never closed | (nothing) | `child.stdin?.end()` after spawn |
| Agents clobber server working tree | `git checkout -b branchName` | `git worktree add` for isolated checkout |

Also fixed:
- `src/index.ts` — wires `Heartbeat` (not `AutonomousWorker`)
- `src/services/SessionManager.ts` — imports `Heartbeat` (not `AutonomousWorker`)
- `src/services/Heartbeat.ts` — NEW file, full service (cron, submitTaskBrief, tick)
- `.claude/deep-research-protocol.md` — updated to 3-pass (was 6-pass)
- `.gitignore` — includes `.worktrees/`
- `AgentOrchestrator.ts` embedded protocol — updated to 3-pass

## Database Was Wiped

`data/app.db` lost its data during branch operations. Needs re-seeding:

```sql
INSERT INTO projects (id, name, description, status, created_at, updated_at)
VALUES ('maslow-app', 'Maslow App', 'Maslow thinking partner — Effect-TS server, Expo mobile client, voice pipeline', 'active', strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT INTO kanban_cards (id, project_id, title, description, "column", position, created_at, updated_at) VALUES
  ('card-001', 'maslow-app', 'Add health endpoint to AppServer', 'Add GET /api/health that returns server uptime, heartbeat status, and running agent count.', 'backlog', 0, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('card-002', 'maslow-app', 'Wire heartbeat status into Build tab', 'Show heartbeat tick history, running agents, and next tick countdown in the Build tab header.', 'backlog', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('card-003', 'maslow-app', 'Add submit task brief UI to Build tab', 'Add a text input to the Build tab that calls submitTaskBrief to create kanban cards from natural language.', 'backlog', 2, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
```

## Claude CLI Spawn Rules (CRITICAL)

Every `spawn("claude", ...)` call in the codebase must follow these rules. There are 3 call sites: 2 in ClaudeSession.ts, 1 in AgentOrchestrator.ts.

| Rule | Wrong | Right |
|------|-------|-------|
| Output format | `--output-format jsonl` | `-p --verbose --output-format stream-json` |
| Permissions | `--bypass-permissions` | `--permission-mode bypassPermissions` |
| Working dir | `--cwd path` | `cwd: path` in spawn() options |
| Stdin | (nothing) | `child.stdin?.end()` immediately after spawn |
| API key | (inherit env) | `delete env.ANTHROPIC_API_KEY` before spawn |
| Env for launchd | (bare PATH) | HOME, USER, SHELL, LANG in plist |

## Service Restart Procedure

```bash
# Correct:
npm run build
launchctl unload ~/Library/LaunchAgents/com.trevor.telegram-claude.plist
sleep 2
launchctl load ~/Library/LaunchAgents/com.trevor.telegram-claude.plist

# NEVER do this (loses launchd env vars):
kill <pid> && node dist/index.js &
```

## Verification Steps

After restart, tail `/tmp/telegram-claude.log` and wait for the next `*/10` minute mark:
1. "Heartbeat tick starting..." should appear
2. "Agent claude spawned on card..." should follow
3. A `.worktrees/<card-id>` directory should be created
4. A Claude process should appear: `ps aux | grep "claude.*bypassPermissions"`
5. The agent should make tool calls and write files (not just spawn and die)

If the agent dies immediately, check:
- `claude auth status` — OAuth must be active
- `/tmp/telegram-claude.error.log` — agent stderr
- The worktree has node_modules? (it's a git checkout, not a fresh clone — node_modules are in the parent)

## Phase 2 Status

Phase 2 is feature-complete:
- Build tab: projects, kanban board, docs, decisions — all working
- Review tab: timeline, conversations, decisions, assumptions, cross-project connections — all working
- All REST + WebSocket APIs implemented
- Agent orchestration, steering engine, heartbeat services all coded

What remains:
1. **Fix agent spawning** (this handoff) — agents spawn but die immediately
2. **Test end-to-end card flow** — chat creates cards, heartbeat picks them up, agents do the work
3. **UI polish** — animations, transitions, loading states
4. **Commit everything** — none of the agent fixes are committed yet

## Key Files

| File | Purpose |
|------|---------|
| `src/services/ClaudeSession.ts` | Spawns Claude CLI for chat (2 spawn sites) |
| `src/services/AgentOrchestrator.ts` | Spawns Claude CLI agents for kanban cards (1 spawn site) |
| `src/services/Heartbeat.ts` | 10-min cron that picks up backlog cards and triggers orchestrator |
| `src/services/SessionManager.ts` | Routes Telegram messages to Claude sessions |
| `src/services/AppServer.ts` | HTTP/WS API server on port 3117 |
| `src/index.ts` | Main entry, layer composition |
| `CLAUDE.md` | Bot instructions — includes spawn config rules |
| `.git/hooks/pre-commit` | Blocks commits with broken CLI flags |
| `~/Library/LaunchAgents/com.trevor.telegram-claude.plist` | launchd service config |
