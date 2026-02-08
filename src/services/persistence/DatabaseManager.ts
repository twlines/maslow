/**
 * DatabaseManager — thin Context.Tag wrapping a better-sqlite3 Database instance.
 *
 * Repositories depend on this tag to obtain a raw database handle.
 */

import { Context } from "effect"
import type Database from "better-sqlite3"

export interface DatabaseManagerService {
  readonly db: Database.Database
}

export class DatabaseManager extends Context.Tag("DatabaseManager")<
  DatabaseManager,
  DatabaseManagerService
>() {}
