---
name: api-endpoint
description: REST API route patterns for AppServer
scope: both
domain: code
context-budget: 250
---

# API Endpoint Conventions

## Route Pattern
Routes are matched with `if` chains in `AppServer.ts`:
```typescript
// Simple path — exact match
if (path === "/api/things" && method === "GET") {
  const data = await Effect.runPromise(db.getThings())
  sendJson(res, 200, { ok: true, data })
  return
}

// Parameterized path — regex match
const thingMatch = path.match(/^\/api\/things\/([^/]+)$/)
if (thingMatch && method === "GET") {
  const id = thingMatch[1]
  const data = await Effect.runPromise(db.getThing(id))
  sendJson(res, 200, { ok: true, data })
  return
}
```

## Response Shape
Always return `{ ok: true, data: ... }` for success:
```typescript
sendJson(res, 200, { ok: true, data: result })
sendJson(res, 201, { ok: true, data: created })
```

For errors:
```typescript
sendJson(res, 404, { ok: false, error: "Not found" })
sendJson(res, 400, { ok: false, error: "Missing required field: name" })
```

## Input Validation
- Parse body with `JSON.parse(await readBody(req))`
- Validate required fields before calling service methods
- Use query params for GET filters: `url.searchParams.get("key")`
- Parse numeric params: `parseInt(url.searchParams.get("limit") || "50")`

## Auth
- All routes (except `/api/health` and `/api/auth/token`) require JWT
- Auth is checked before the route matching block
- Do not add auth checks inside individual routes
