---
name: sql-migration
description: SQLite schema and migration patterns for Maslow
scope: both
domain: code
context-budget: 300
---

# SQLite Conventions

## Schema Creation
```sql
CREATE TABLE IF NOT EXISTS my_table (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_my_table_project ON my_table(project_id);
```

## Migrations (Adding Columns)
```typescript
const cols = db.pragma("table_info(my_table)") as Array<{ name: string }>
if (!cols.some((c) => c.name === "new_column")) {
  db.exec(`ALTER TABLE my_table ADD COLUMN new_column TEXT`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_my_table_new ON my_table(new_column)`)
}
```

## Prepared Statements
All queries go in the `stmts` object:
```typescript
const stmts = {
  getById: db.prepare(`SELECT * FROM my_table WHERE id = ?`),
  create: db.prepare(`INSERT INTO my_table (id, name, created_at) VALUES (?, ?, ?)`),
  update: db.prepare(`UPDATE my_table SET name = ?, updated_at = ? WHERE id = ?`),
}
```

## Rules
- Always use prepared statements — never concatenate SQL strings
- Wrap all `better-sqlite3` calls in `Effect.sync()`, not `Effect.tryPromise()`
- JSON columns: store as `TEXT`, parse with `JSON.parse()` on read
- Timestamps are INTEGER (Unix epoch milliseconds)
- IDs are TEXT (UUID via `crypto.randomUUID()`)
- `PRAGMA foreign_keys = ON` is set at connection time
