# Heartbeat Checklist

The agent reads this file every 10-minute tick. Edit priorities in plain English.
Lines starting with `- [x]` are enabled. Lines starting with `- [ ]` are disabled.

## Builder Tasks
- [x] Process backlog kanban cards (one per project, max 3 concurrent)
- [x] Retry blocked cards older than 30 minutes
- [ ] Skip cards tagged `interactive-only`

## Synthesizer Tasks (runs at :19, :39)
- [x] Merge branch-verified cards into integration branch (Gate 2)
- [x] Collect campaign metrics
- [ ] Generate cross-project synthesis report

## Daily Tasks (10pm)
- [x] Draft PRs for merge-verified work
- [ ] Send daily digest to Telegram
- [ ] Clean up stale worktrees older than 24 hours

## Notifications
- [x] Telegram: agent spawned
- [x] Telegram: Gate 2 passed/failed
- [x] Telegram: campaign completed
- [x] WebSocket: all heartbeat events
- [ ] Telegram: daily summary at 9pm

## Agent Constraints
- [x] Max concurrent agents: 3
- [x] Blocked retry interval: 30 minutes
- [ ] Skip cards with context > 20K chars (mark as interactive-only)
