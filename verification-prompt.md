# Verification — A2: Apply PSD File Anatomy to All Services

## Card
A2: Apply PSD file anatomy to all services

## Acceptance Criteria
1. All 18 service files in `src/services/` have standardized section separators
2. All 18 service files have module docblocks with DESIGN INTENT
3. All 18 service files have LOG_PREFIX constants
4. `any` types replaced: `mapCardRow(r: any)` → typed row interface, `wss: any` → `WebSocketServer | null`, `clients: Set<any>` → `Set<TrackedWebSocket>`
5. Section order: docblock → external imports → internal imports → constants → types → service tag → implementation
6. No new type errors introduced (pre-existing errors in AppServer.ts/index.ts are out of scope)
7. No lint errors (warnings for unused LOG_PREFIX are expected — preparatory constants)

## Verification Steps

### 1. Section Anatomy
```bash
# Every file has DESIGN INTENT docblock (expect 18)
grep -rl "DESIGN INTENT" src/services/ | wc -l

# Every file has LOG_PREFIX (expect 18)
grep -rl "LOG_PREFIX" src/services/ | wc -l

# Every file has section separators (expect 18)
grep -rl "// ─── External Imports" src/services/ | wc -l
```

### 2. No `any` Types
```bash
# Zero matches expected
grep -rn ": any\b\|as any\b\|<any>\|any\[\]" src/services/
```

### 3. Type Check
```bash
# Only pre-existing errors (AuditLogFilters, search, getAuditLog, backupDatabase, duplicate Heartbeat)
npx tsc --noEmit 2>&1 | grep -c "error TS"
# Expected: 7 (all pre-existing)
```

### 4. Lint
```bash
# Zero errors, warnings only
npx eslint src/services/ 2>&1 | grep -c "error"
# Expected: 0
```

## Files Changed (18 service files + 1 verification file)

| File | Docblock | Separators | LOG_PREFIX | `any` Fixes |
|------|----------|------------|------------|-------------|
| AgentOrchestrator.ts | Added | Added | Added | — |
| AppPersistence.ts | Added | Added | Added | `mapCardRow(r: KanbanCardRow)`, 12 row casts typed |
| AppServer.ts | Added | Added | Added | `wss: WebSocketServer \| null`, `clients: Set<TrackedWebSocket>`, 5 `ws` params typed |
| ClaudeMem.ts | Added | Added | Added | — |
| ClaudeSession.ts | Added | Added | Added | `ContentBlock[]` cast, `ModelUsageStats` type |
| Config.ts | Added | Added | Existed | — |
| Heartbeat.ts | Added | Added | Added | — |
| Kanban.ts | Added | Added | Added | — |
| MessageFormatter.ts | Added | Added | Added | — |
| Notification.ts | Added | Added | Added | — |
| Persistence.ts | Added | Added | Added | — |
| Proactive.ts | Added | Added | Added | — |
| SessionManager.ts | Added | Added | Existed | — |
| SoulLoader.ts | Added | Added | Existed | `(error as any)` → `NodeJS.ErrnoException` |
| SteeringEngine.ts | Added | Added | Existed | — |
| Telegram.ts | Added | Added | Existed | — |
| ThinkingPartner.ts | Added | Added | Added | — |
| Voice.ts | Added | Added | Added | — |

## New Types Introduced

### AppPersistence.ts (internal, not exported)
- `KanbanCardRow` — SQLite row shape for kanban_cards table
- `ProjectRow` — SQLite row shape for projects table
- `DocumentRow` — SQLite row shape for project_documents table
- `DecisionRow` — SQLite row shape for decisions table
- `MaxPositionRow` — Aggregate query result for MAX(position)
- `MaxPriorityRow` — Aggregate query result for MAX(priority)

### AppServer.ts (internal, not exported)
- `TrackedWebSocket` — Extends `WebSocket` with `_missedPings` for heartbeat tracking

### ClaudeSession.ts (internal, not exported)
- `ContentBlock` — Claude API JSONL content block shape
- `ModelUsageStats` — Model usage statistics from CLI result event
