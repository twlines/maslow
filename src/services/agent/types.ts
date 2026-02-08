/**
 * Shared types for the Agent sub-modules.
 */

import type { Effect } from "effect"
import type { ChildProcess } from "child_process"
import type { AgentType, AgentStatus } from "../AppPersistence.js"

export interface AgentProcess {
  cardId: string
  projectId: string
  agent: AgentType
  process: ChildProcess | null
  status: AgentStatus
  startedAt: number
  logs: string[]
  branchName: string
}

export interface AgentLogEvent {
  cardId: string
  line: string
  timestamp: number
}

export interface ProcessManagerDeps {
  kanban: {
    updateAgentStatus(id: string, status: AgentStatus, reason?: string): Effect.Effect<void>
    completeWork(id: string): Effect.Effect<void>
    saveContext(id: string, snapshot: string, sessionId?: string): Effect.Effect<void>
  }
  db: {
    logAudit(entityType: string, entityId: string, action: string, details?: Record<string, unknown>, actor?: string): Effect.Effect<void>
    insertTokenUsage(usage: {
      cardId: string
      projectId: string
      agent: AgentType
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      costUsd: number
      createdAt: number
    }): Effect.Effect<unknown>
  }
  telegram: {
    sendMessage(chatId: string | number, text: string, options?: unknown): Effect.Effect<unknown, Error>
  }
  chatId: string | number
  broadcast: (message: Record<string, unknown>) => void
}
