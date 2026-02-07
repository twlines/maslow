---
name: wire-feature
description: Scaffold and wire a full-stack feature across server, shared types, and client. Use when adding a new API endpoint, WebSocket message type, or feature that touches multiple layers. Invoke with /wire-feature <feature-name> [--rest] [--ws] [--both].
---

# Full-Stack Feature Wiring

When a feature touches server + shared types + client, there are 4-6 files that need coordinated changes. This skill identifies all touch points and scaffolds the changes so nothing gets missed.

## The Maslow Stack

Every feature flows through these layers:

```
Client (apps/mobile/)
  ├── app/(tabs)/*.tsx          — UI components
  └── services/api.ts           — API client + WS handlers
        ↓
Shared (packages/shared/)
  └── src/types/index.ts        — WS message types, shared interfaces
        ↓
Server (src/services/)
  ├── AppServer.ts              — HTTP routes + WS handlers
  ├── <Service>.ts              — Business logic (Kanban, ThinkingPartner, etc.)
  └── AppPersistence.ts         — Database queries
```

## Workflow

1. **Parse the feature** — name, transport (REST, WS, or both)
2. **Read current files** — AppServer.ts routes, shared types, api.ts client
3. **Identify all touch points** — list every file and section that needs changes
4. **Generate scaffolding** — for each touch point, produce the code needed
5. **Apply changes** — edit files in dependency order (shared → server → client)
6. **Verify** — run type-check to confirm everything compiles

## Touch Point Checklist

For a **REST endpoint**:

| Layer | File | Change |
|-------|------|--------|
| Server | `src/services/AppServer.ts` | Add route handler (GET/POST/PUT/DELETE) |
| Server | `src/services/<Service>.ts` | Add business logic method |
| Server | `src/services/AppPersistence.ts` | Add DB query (if data is persisted) |
| Shared | `packages/shared/src/types/index.ts` | Add request/response types (if needed) |
| Client | `apps/mobile/services/api.ts` | Add API method |
| Client | `apps/mobile/app/(tabs)/*.tsx` | Wire into UI |

For a **WebSocket message**:

| Layer | File | Change |
|-------|------|--------|
| Shared | `packages/shared/src/types/index.ts` | Add to `WSClientMessage` or `WSServerMessage` union |
| Server | `src/services/AppServer.ts` | Add WS message handler (client→server) or emitter (server→client) |
| Client | `apps/mobile/services/api.ts` | Add to `onmessage` switch (server→client) or add send method (client→server) |
| Client | `apps/mobile/app/(tabs)/*.tsx` | Wire into UI callback |

## Scaffolding Templates

### REST Route (AppServer.ts)

```typescript
// GET /api/<resource>
app.get("/api/<resource>", async (req, res) => {
  try {
    const result = yield* service.getResource()
    res.json({ ok: true, data: result })
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to get resource" })
  }
})
```

### WS Message Type (shared types)

```typescript
// In WSClientMessage union:
| { type: "<feature.action>"; /* payload fields */ }

// In WSServerMessage union:
| { type: "<feature.result>"; /* payload fields */ }
```

### API Client Method

```typescript
// REST method
async getResource(): Promise<unknown> {
  const res = await fetch(`${this.baseUrl}/api/resource`, {
    headers: this.headers(),
  })
  const json = await res.json()
  return json.data
}
```

### WS Handler (api.ts onmessage)

```typescript
case "<feature.result>":
  callbacks.onFeatureResult?.(msg.data)
  break
```

## Style Rules

Match the existing codebase exactly:
- No semicolons
- Double quotes
- 2-space indent
- REST responses: `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`
- WS message types use dot notation: `"feature.action"`, `"workspace.action"`
- Error handling: try/catch in route handlers, Effect error channel in services

## Verification

After making all changes, run:
1. `npx tsc --noEmit` — type-check passes
2. `npx eslint .` — no new errors introduced

If either fails, fix the issues before reporting success.
