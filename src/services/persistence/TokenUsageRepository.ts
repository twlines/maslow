/**
 * TokenUsageRepository — token usage persistence extracted from AppPersistence.
 *
 * Provides insertTokenUsage to store agent token consumption records.
 * Depends only on DatabaseManager.
 */

import { Context, Effect, Layer } from "effect"
import { randomUUID } from "crypto"
import { DatabaseManager } from "./DatabaseManager.js"

export interface TokenUsage {
  id: string
  cardId: string | null
  projectId: string
  agent: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  createdAt: number
}

export interface TokenUsageRepositoryService {
  insertTokenUsage(usage: Omit<TokenUsage, "id">): Effect.Effect<TokenUsage>
}

export class TokenUsageRepository extends Context.Tag("TokenUsageRepository")<
  TokenUsageRepository,
  TokenUsageRepositoryService
>() {}

export const TokenUsageRepositoryLive = Layer.effect(
  TokenUsageRepository,
  Effect.gen(function* () {
    const { db } = yield* DatabaseManager

    const stmts = {
      insert: db.prepare(`
        INSERT INTO token_usage (id, card_id, project_id, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
    }

    return {
      insertTokenUsage: (usage) =>
        Effect.sync(() => {
          const id = randomUUID()
          stmts.insert.run(
            id,
            usage.cardId ?? null,
            usage.projectId,
            usage.agent,
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadTokens,
            usage.cacheWriteTokens,
            usage.costUsd,
            usage.createdAt
          )
          return { id, ...usage }
        }),
    }
  })
)
