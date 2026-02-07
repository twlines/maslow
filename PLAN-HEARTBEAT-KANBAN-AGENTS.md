# Plan: Heartbeat Fix + Kanban Upgrade + Agent Orchestration

## Overview

Three connected pieces:
1. **Fix heartbeat** — so Maslow stays alive when idle
2. **Upgrade kanban** — from passive CRUD board to active work-coordination layer ("keep your place")
3. **Terminal agent orchestration** — spawn and manage sub-agents (Codex, Gemini CLI, Claude) from the kanban board

---

## Part 1: Fix Heartbeat (AppServer.ts)

### Problem
The server handles ping/pong but never *sends* pings. Idle WebSocket connections silently die after NAT/firewall timeouts. No cleanup on disconnect. No connection health tracking.

### Changes

**AppServer.ts — WebSocket connection handler:**

1. **Server-side ping interval** — On each new WebSocket connection, start a 30-second `setInterval` that sends `{ type: "ping" }`. Track `isAlive` flag per client, reset on pong. If a client misses 2 consecutive pings, terminate the connection.

2. **Connection cleanup on close** — Clear the ping interval. Log disconnect with duration.

3. **Client tracking** — Maintain a `Set<WebSocket>` of active clients so we can broadcast events (needed for agent status updates later).

**api.ts (mobile client):**

4. **Client-side pong response** — Already exists (`case "pong": break`). No change needed. But add a `lastPong` timestamp and show "Reconnecting..." if no pong received in 45 seconds.

**Estimated scope:** ~30 lines in AppServer.ts, ~10 lines in api.ts.

---

## Part 2: Kanban Upgrade — "Keep Your Place"

### Problem
Current kanban is passive CRUD. Cards have: title, description, column, position, labels, dueDate. No concept of "where you left off," no work queue, no momentum tracking.

### Design: Card State Enrichment

Add these fields to `kanban_cards` table (via ALTER TABLE migrations in AppPersistence.ts):

```
context_snapshot TEXT    -- Last working context: what was being done, key decisions, blockers
last_session_id TEXT    -- Claude session ID that was working on this card
assigned_agent  TEXT    -- Which agent is working on it: "claude" | "codex" | "gemini" | null
agent_status    TEXT    -- "idle" | "running" | "blocked" | "completed" | "failed"
priority        INTEGER -- Explicit priority (lower = higher priority), default 0
blocked_reason  TEXT    -- Why this card is stuck (if agent_status = "blocked")
started_at      INTEGER -- When card moved to in_progress
completed_at    INTEGER -- When card moved to done
```

### Design: Pull-Based Work Queue

New Kanban service methods:

```typescript
// Get next card to work on (highest priority in backlog)
getNext(projectId: string): Effect.Effect<AppKanbanCard | null>

// Skip a card to end of queue (like AutoForge's feature_skip)
skipToBack(id: string): Effect.Effect<void>

// Save context snapshot before leaving a card
saveContext(id: string, snapshot: string, sessionId?: string): Effect.Effect<void>

// Resume card — returns the context snapshot
resume(id: string): Effect.Effect<{ card: AppKanbanCard; context: string | null }>

// Assign agent to card
assignAgent(id: string, agent: string): Effect.Effect<void>

// Update agent status
updateAgentStatus(id: string, status: string, reason?: string): Effect.Effect<void>
```

### Design: "Keep Your Place" Flow

When a conversation touches a kanban card:
1. On **start work**: Card moves to `in_progress`, `started_at` set, `assigned_agent` set
2. During **work**: Context snapshots saved periodically (what's been done, what's next)
3. On **pause/switch**: Latest context snapshot persisted, card stays in `in_progress`
4. On **resume**: Context snapshot loaded into prompt so the agent picks up mid-thought
5. On **block**: Card stays in `in_progress` but `agent_status = "blocked"`, `blocked_reason` set
6. On **skip**: Card moves back to `backlog` at lowest priority (end of queue)
7. On **complete**: Card moves to `done`, `completed_at` set

### API Changes (AppServer.ts)

New REST endpoints:
- `GET /api/projects/:id/cards/next` — Pull next card from queue
- `POST /api/projects/:id/cards/:cardId/context` — Save context snapshot
- `POST /api/projects/:id/cards/:cardId/skip` — Skip to back of queue
- `POST /api/projects/:id/cards/:cardId/assign` — Assign agent

New WebSocket messages (server → client):
- `card.assigned` — Agent assigned to card
- `card.status` — Agent status changed
- `card.context` — Context snapshot saved
- `agent.log` — Real-time log from running agent

### Client Changes (build.tsx)

- Show agent assignment badge on cards (icon: Claude/Codex/Gemini)
- Show agent status indicator (running spinner, blocked warning, etc.)
- "Resume" button on in_progress cards — loads context and starts conversation
- Priority drag-reorder within backlog column
- Card detail shows context snapshot (last working state)

### Shared Types (packages/shared)

Update `KanbanCard` interface with new fields. Add `AgentType` and `AgentStatus` types.

---

## Part 3: Terminal Agent Orchestration (New Service)

### Design: AgentOrchestrator Service

New service: `src/services/AgentOrchestrator.ts`

Manages spawning, monitoring, and coordinating CLI-based coding agents.

```typescript
export interface AgentOrchestratorService {
  // Spawn an agent to work on a card
  spawnAgent(options: {
    cardId: string
    projectId: string
    agent: "claude" | "codex" | "gemini"
    prompt: string
    cwd: string
  }): Effect.Effect<AgentProcess, Error>

  // Stop a running agent
  stopAgent(cardId: string): Effect.Effect<void, Error>

  // Get status of all running agents
  getRunningAgents(): Effect.Effect<AgentProcess[]>

  // Stream logs from a running agent
  streamLogs(cardId: string): Stream.Stream<AgentLogEvent, Error>
}
```

### Agent Spawn Patterns

Each agent type has a different CLI interface:

**Claude Code:**
```bash
claude -p --output-format stream-json --bypass-permissions --max-turns 50 --cwd <path> "<prompt>"
```
Already implemented in ClaudeSession.ts. Reuse the JSONL parser.

**OpenAI Codex:**
```bash
codex --approval-mode full-auto --json "<prompt>"
# or with quiet mode for non-interactive
codex -q "<prompt>"
```
Needs: `@openai/codex` installed globally. Outputs JSON events.

**Gemini CLI:**
```bash
gemini -y "<prompt>"
# -y = auto-accept all tool calls (full auto mode)
```
Needs: `@google/gemini-cli` installed globally.

### Agent Lifecycle

1. **Spawn**: Fork child process, assign to card via `kanban.assignAgent()`
2. **Monitor**: Parse stdout for progress events, stream to WebSocket as `agent.log`
3. **Heartbeat**: Check process is alive every 10 seconds
4. **Complete**: On process exit code 0, mark card as done, save output as context
5. **Fail**: On non-zero exit, mark card as blocked with error reason
6. **Kill**: On user request or timeout, SIGTERM → wait 5s → SIGKILL

### Concurrency Control

- Config: `MAX_CONCURRENT_AGENTS` (default: 3, configurable via .env)
- Queue: If max reached, cards stay in backlog until a slot opens
- Per-project limit: 1 agent per project (prevent conflicts in same codebase)

### WebSocket Integration

All agent events broadcast to connected clients:
- `agent.spawned` — New agent started on card
- `agent.log` — Streamed output line
- `agent.progress` — Periodic progress summary
- `agent.completed` — Agent finished successfully
- `agent.failed` — Agent hit error
- `agent.stopped` — Agent killed by user

### Layer Composition

```
AgentOrchestrator depends on:
  - Kanban (to update card status)
  - AppPersistence (to save context snapshots)
  - ConfigService (for agent limits, paths)

New layer order:
Config
  → Persistence, Telegram, AppPersistence, Voice, ClaudeMem, SoulLoader
    → Kanban, ThinkingPartner
    → ClaudeSession
    → AgentOrchestrator  ← NEW (needs Kanban + Config)
      → AutonomousWorker
        → SessionManager
        → AppServer
```

### API Endpoints (AppServer.ts)

- `POST /api/agents/spawn` — `{ cardId, projectId, agent, prompt }`
- `DELETE /api/agents/:cardId` — Stop agent
- `GET /api/agents` — List running agents
- `GET /api/agents/:cardId/logs` — Recent log output

### Client: Mission Control View

New sub-tab in Build mode (or overlay):
- Shows all running agents as live tiles
- Each tile: card title, agent type icon, elapsed time, last log line, status indicator
- Stop/restart buttons per agent
- Log viewer on tap (scrolling terminal output)

---

## Implementation Order

### Step 1: Heartbeat Fix (~20 min)
- AppServer.ts: server-side ping interval + client tracking + cleanup
- api.ts: connection health display

### Step 2: Kanban Schema Migration (~30 min)
- AppPersistence.ts: ALTER TABLE for new fields
- Kanban.ts: new service methods (getNext, skipToBack, saveContext, resume, assignAgent, updateAgentStatus)
- Shared types update

### Step 3: Kanban API + Client (~45 min)
- AppServer.ts: new REST endpoints
- build.tsx: agent badges, status indicators, resume button, context viewer

### Step 4: AgentOrchestrator Service (~1 hr)
- New service file with spawn/monitor/stop lifecycle
- JSONL/stdout parsing for each agent type
- WebSocket event broadcasting
- Wire into layer composition in index.ts

### Step 5: Mission Control UI (~30 min)
- Agent status tiles in Build mode
- Log viewer
- Spawn/stop controls

---

## Part 4: Browser Access for Agents

### Problem
Agents working on UI features can't see the result. They write code, run it, but have no way to verify visual output. They spin on layout bugs, broken links, missing styles — wasting tokens on things a glance would resolve.

### Two Options Evaluated

**Option A: Vercel agent-browser (Recommended)**
- Rust-based CLI, zero-config, works with Claude/Codex/Gemini out of the box
- `snapshot + refs` system: returns accessibility tree with `@e1`, `@e2` refs — agents reference elements by ID, not brittle CSS selectors
- 93% context reduction vs raw DOM — only sends actionable elements
- Stateful sessions (`--session agent1`) — each agent gets its own browser
- Persistent profiles for login state across restarts
- Commands: `open`, `click`, `fill`, `snapshot`, `screenshot`, `wait`, `get text/html/url`, `find role`, `eval`
- Semantic locators: `find role button --name "Submit"` — accessibility-first, not DOM-first
- Install: `npm install -g agent-browser && agent-browser install`

**Option B: Playwright MCP (Microsoft)**
- MCP server that exposes Playwright as tools — works with Claude Code natively
- Accessibility tree based (similar concept to agent-browser)
- Richer feature set: PDF gen, tracing, video recording, multi-browser (Chrome/Firefox/WebKit)
- Heavier — Node.js based, more context per snapshot
- Install: `npx @playwright/mcp@latest` or `claude mcp add playwright`

### Recommendation: agent-browser as default, Playwright MCP as fallback

agent-browser is purpose-built for what we need: lightweight, context-efficient, CLI-native. Agents call it like any other shell tool. No MCP configuration needed (though it supports it).

Playwright MCP is better for deep testing workflows (tracing, video, multi-browser) but costs more context per interaction.

### Integration with AgentOrchestrator

When spawning an agent on a card, the orchestrator:
1. Starts an `agent-browser` session named after the card ID
2. Injects browser commands into the agent's prompt: "Use `agent-browser snapshot` to check your UI changes"
3. Agent uses `agent-browser open http://localhost:8081` → `agent-browser snapshot -i` → sees interactive elements → verifies its work
4. On agent completion, `agent-browser` session is cleaned up

### Agent Prompt Injection

Each spawned agent gets a system instruction block:

```
## Browser Access
You have browser access via the `agent-browser` CLI.
- `agent-browser open <url>` — open a page
- `agent-browser snapshot` — get accessibility tree (compact, AI-friendly)
- `agent-browser snapshot -i` — interactive elements only
- `agent-browser click @e<N>` — click element by ref
- `agent-browser fill @e<N> "text"` — fill input
- `agent-browser screenshot` — capture screenshot
- `agent-browser get text` — get page text content
Use this to verify UI changes after implementing them.
```

### No Code Changes Needed in Maslow

agent-browser is a standalone CLI tool. Agents invoke it via shell commands — no Maslow service integration required. We just:
1. Install it globally
2. Include browser instructions in the agent spawn prompt
3. Optionally manage sessions (start/cleanup) in AgentOrchestrator

---

## Dependencies to Install

- None for heartbeat or kanban
- `@openai/codex` — for Codex CLI agent (global install, optional)
- `@google/gemini-cli` — for Gemini CLI agent (global install, optional)
- `agent-browser` — for browser access (global install, optional)
- All optional — system degrades gracefully if not installed

---

## Part 5: GitHub-Native Trust Model + Verification Agents

### Core Insight

GitHub is already a trust layer. Branches are sandboxed. PRs are reviewable and reversible. CI gates deployments. Instead of building a custom approval system for every file write, we route all agent work through `gh` and let the existing Git/GitHub workflow contain blast radius.

### The Model

**Agent works on a branch → commits freely → opens PR with `verification-prompt.md` → reviewing agent verifies → you merge (or auto-merge if verification passes + CI green).**

### Trust Tiers (Simplified via GitHub)

#### Tier 1: Full Autonomy — No approval needed
- All local work: file writes, commits, branch creation, test runs, linting
- Read-only research (code search, docs, browsing via agent-browser)
- Opening PRs via `gh pr create`
- Kanban card updates (status, context snapshots, assignment)
- Daily cron tasks (briefings, synthesis, assumption scanning)
- Running verification prompts against other agents' PRs
- Credential access for tokens explicitly marked Tier 1 (read-only)

**Key: Everything here is branch-scoped. Can't hurt main. Can't hurt production.**

#### Tier 2: Human Approval — You merge
- PR merge to main (you review + approve, or auto-merge when verification agent + CI both pass)
- Credential access for write-capable tokens
- Spawning agents on new projects (first-time project access)

**Key: The PR is the approval boundary. You see the diff, the verification report, and CI status before anything lands.**

#### Tier 3: Seated Session — Always blocked until you're at the keyboard
- Deployments to any environment
- Force pushes to any branch
- Modifying CI/CD pipelines
- Deleting branches or repos
- First-time credential registration
- Modifying trust tier configuration

### verification-prompt.md — Every PR Gets One

When an agent opens a PR, it includes a `verification-prompt.md` file in the PR branch. This file tells the reviewing agent exactly how to verify the work.

#### Structure

```markdown
# Verification Prompt

## Card
[Card title and ID from kanban board]

## Goals
- [ ] [Specific goal 1 from the card description]
- [ ] [Specific goal 2]
- [ ] [Specific goal 3]

## Acceptance Criteria
- [ ] All goals above are accomplished in the diff
- [ ] No breaking changes to existing functionality
- [ ] Types pass (`npm run type-check`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm run test`)
- [ ] No secrets, credentials, or .env files in diff
- [ ] Changes are scoped to the card — no unrelated modifications

## Verification Steps
1. [Specific instruction: "Run the app and navigate to /settings — the toggle should appear"]
2. [Specific instruction: "Check that the API response includes the new field"]
3. [Specific instruction: "Verify the migration runs cleanly on a fresh DB"]

## Context
[What the agent was working on, what decisions it made, what it wasn't sure about]

## Files Changed
[Auto-generated list of files in the diff with brief description of each change]
```

#### Workflow

1. **Building agent** finishes work on branch
2. Agent generates `verification-prompt.md` from the kanban card + its own work context
3. Agent runs `gh pr create` with the verification prompt summary in the PR body
4. **Reviewing agent** is spawned automatically (different agent instance, fresh context)
5. Reviewer reads `verification-prompt.md`, checks out the branch, runs verification steps
6. Reviewer posts results as a PR comment via `gh pr comment`
7. If all checks pass: PR is flagged as verified (label or comment)
8. **You merge** — or, if configured, auto-merge when verified + CI green

#### Reviewing Agent Prompt

The reviewing agent gets spawned with:

```
You are reviewing a pull request. Your job is to verify the work against the
verification prompt, NOT to rewrite or improve the code.

1. Read verification-prompt.md in the PR branch
2. Review the diff against each goal and acceptance criterion
3. Run each verification step
4. Use agent-browser to visually verify UI changes if applicable
5. Post your findings as a PR comment with pass/fail per criterion
6. Do NOT approve or merge — only report findings

If any criterion fails, explain exactly what failed and why.
If all criteria pass, confirm with "VERIFIED: All criteria pass."
```

### Credential Vault (Retained, Simplified)

Credentials still need secure storage — agents need API tokens to run `gh`, access private registries, etc. But the vault is simpler now because most dangerous actions go through GitHub's own auth.

#### Schema

```sql
CREATE TABLE credential_vault (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,       -- "github_pat_aiden", "vercel_token", etc.
  encrypted_value TEXT NOT NULL,   -- AES-256-GCM encrypted
  iv TEXT NOT NULL,                -- Initialization vector
  type TEXT NOT NULL,              -- "api_token" | "password" | "ssh_key" | "oauth"
  tier INTEGER DEFAULT 2,         -- 1=auto-access, 2=approval-required, 3=seated-only
  allowed_projects TEXT,           -- JSON array: ["aiden", "maslow"] or null for all
  allowed_agents TEXT,             -- JSON array: ["claude", "codex"] or null for all
  created_at INTEGER NOT NULL,
  last_accessed INTEGER,
  access_count INTEGER DEFAULT 0,
  notes TEXT                       -- "Read-only GitHub PAT for Aiden CI"
);

CREATE TABLE credential_access_log (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  card_id TEXT,
  action TEXT NOT NULL,            -- "read" | "denied" | "escalated"
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (credential_id) REFERENCES credential_vault(id)
);
```

#### Design

- Encrypted at rest using AES-256-GCM (existing `packages/shared` crypto)
- Vault key derived from biometric unlock, stored in macOS Keychain / expo-secure-store
- Vault auto-locks after 15 minutes of inactivity
- Each credential scoped to specific projects + agent types
- Every access logged in credential_access_log
- agent-browser persistent profiles preferred over raw passwords for web services

### Hard Blocks (Inviolable — No Override)

These are never allowed regardless of context. The system enforces them structurally:

- `git push --force` to any branch
- `rm -rf` on directories outside project scope
- Committing `.env`, credential files, or SSH keys
- Deploying to production (always Tier 3)
- Modifying the trust tier configuration itself
- Agent accessing credentials not in its allowed_projects/allowed_agents scope
- Agent working outside the card's designated project directory

### Audit Trail

```sql
CREATE TABLE agent_audit_log (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  agent_type TEXT NOT NULL,
  action_type TEXT NOT NULL,       -- "branch_create" | "commit" | "pr_create" | "pr_verify" | etc.
  action_detail TEXT,              -- JSON: specifics
  pr_number INTEGER,              -- GitHub PR number if applicable
  outcome TEXT NOT NULL,           -- "executed" | "verified" | "failed_verification" | "blocked"
  timestamp INTEGER NOT NULL
);
```

Visible in Review tab. "Show me all PRs Codex opened this week and their verification results."

---

## Implementation Order (Updated)

### Step 1: Heartbeat Fix (~20 min)
### Step 2: Kanban Schema Migration (~30 min)
### Step 3: Kanban Service Methods + API (~45 min)
### Step 4: AgentOrchestrator Service (~1 hr)
- Spawn/monitor/stop agent lifecycle
- Agent works on feature branch (auto-created from card title)
- On completion: agent generates verification-prompt.md + opens PR via `gh`
- On PR open: reviewing agent auto-spawned
### Step 5: Mission Control UI (~30 min)
### Step 6: Verification Agent Pipeline (~45 min)
- Reviewing agent spawned on PR creation
- Reads verification-prompt.md, runs checks, posts PR comment
- Auto-label PRs as verified/failed
### Step 7: Credential Vault (~45 min)
- credential_vault + credential_access_log tables
- Encrypt/decrypt using existing crypto
- Vault lock/unlock lifecycle tied to biometric session
- API endpoints for vault management
### Step 8: Mobile PR Review UI (~30 min)
- Push notification when PR verified and ready for merge
- PR detail view with verification results
- Approve/merge via FaceID from phone

---

## Risk Assessment

- **Heartbeat**: Low risk, well-understood pattern
- **Kanban migration**: Low risk, additive columns only
- **Agent orchestration**: Medium risk — child process management. Mitigated by per-project limit of 1 + branch isolation
- **GitHub-native trust model**: Low risk — leverages existing, battle-tested infrastructure. Blast radius contained by branches
- **Verification agents**: Low risk — read-only reviewers, can't modify code, only post comments
- **Credential vault**: Medium risk — encryption proven (AES-256-GCM), vault lifecycle needs testing. No credential ever logged in plaintext
- **Auto-merge**: Medium risk — only enabled when both verification agent AND CI pass. Can be disabled per-repo
