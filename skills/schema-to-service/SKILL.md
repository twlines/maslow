---
name: schema-to-service
description: End-to-end pipeline for adding a new entity to Maslow
scope: both
domain: code
context-budget: 350
---

# Schema-to-Service Pipeline

When adding a new entity (e.g., "campaigns", "templates"), follow this 5-file pipeline in order.

## Step 1: Shared Types (`packages/shared/src/types/index.ts`)
```typescript
export interface Campaign {
  id: string
  projectId: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
}
```

## Step 2: Database Schema (`src/services/AppPersistence.ts`)

Add table creation in the schema init block:
```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id);
```

Add prepared statements to `stmts`:
```typescript
getCampaigns: db.prepare(`SELECT * FROM campaigns WHERE project_id = ? ORDER BY created_at DESC`),
getCampaign: db.prepare(`SELECT * FROM campaigns WHERE id = ?`),
createCampaign: db.prepare(`INSERT INTO campaigns (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`),
updateCampaign: db.prepare(`UPDATE campaigns SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?`),
deleteCampaign: db.prepare(`DELETE FROM campaigns WHERE id = ?`),
```

Add service methods that wrap stmts in `Effect.sync()`.

## Step 3: API Routes (`src/services/AppServer.ts`)

Add CRUD routes following the existing pattern:
- `GET /api/projects/:id/campaigns` — list
- `POST /api/projects/:id/campaigns` — create
- `GET /api/campaigns/:id` — detail
- `PUT /api/campaigns/:id` — update
- `DELETE /api/campaigns/:id` — delete

## Step 4: Tests (`src/__tests__/`)

Test the service methods with a test layer providing AppPersistence.

## Step 5: Verify

Run the full gate: `npm run type-check && npm run lint && npm test -- --run`
