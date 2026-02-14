/**
 * Zod Schemas — Runtime Validation + Test Assertions
 *
 * These schemas mirror the TypeScript interfaces in types/index.ts.
 * Dual purpose:
 *   1. Runtime validation at API boundaries (request/response)
 *   2. Test assertions (assert response shape matches contract)
 *
 * Convention: Schema name = interface name + "Schema" suffix.
 * Use z.infer<typeof XSchema> to derive types when needed.
 */

import { z } from "zod"

// ============================================================================
// Enums & Literals
// ============================================================================

export const AgentTypeSchema = z.enum(["ollama", "codex", "gemini"])
export const AgentStatusSchema = z.enum(["idle", "running", "blocked", "completed", "failed"])
export const VerificationStatusSchema = z.enum([
  "unverified",
  "branch_verified",
  "branch_failed",
  "merge_verified",
  "merge_failed",
])
export const CorrectionDomainSchema = z.enum([
  "code-pattern", "communication", "architecture", "preference", "style", "process",
])
export const CorrectionSourceSchema = z.enum([
  "explicit", "pr-rejection", "edit-delta", "agent-feedback",
])

// ============================================================================
// Core Models
// ============================================================================

export const MessageSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  conversationId: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ConversationSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  claudeSessionId: z.string(),
  status: z.enum(["active", "archived"]),
  contextUsagePercent: z.number(),
  summary: z.string().nullable(),
  messageCount: z.number(),
  firstMessageAt: z.number(),
  lastMessageAt: z.number(),
})

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["active", "archived", "paused"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  color: z.string().optional(),
  agentTimeoutMinutes: z.number().optional(),
  maxConcurrentAgents: z.number().optional(),
})

export const ProjectDocumentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.enum(["brief", "instructions", "reference", "decisions", "assumptions", "state"]),
  title: z.string(),
  content: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const KanbanCardSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  column: z.enum(["backlog", "in_progress", "done"]),
  labels: z.array(z.string()),
  dueDate: z.number().optional(),
  linkedDecisionIds: z.array(z.string()),
  linkedMessageIds: z.array(z.string()),
  position: z.number(),
  priority: z.number(),
  contextSnapshot: z.string().nullable(),
  lastSessionId: z.string().nullable(),
  assignedAgent: AgentTypeSchema.nullable(),
  agentStatus: AgentStatusSchema.nullable(),
  blockedReason: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  verificationStatus: VerificationStatusSchema.nullable(),
  campaignId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const DecisionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  alternatives: z.array(z.string()),
  reasoning: z.string(),
  tradeoffs: z.string(),
  createdAt: z.number(),
  revisedAt: z.number().optional(),
})

export const SteeringCorrectionSchema = z.object({
  id: z.string(),
  correction: z.string(),
  domain: CorrectionDomainSchema,
  source: CorrectionSourceSchema,
  context: z.string().nullable(),
  projectId: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.number(),
})

// ============================================================================
// System Models
// ============================================================================

export const HealthStatusSchema = z.object({
  status: z.literal("ok"),
  uptime: z.number(),
  timestamp: z.number(),
  heartbeat: z.object({
    intervalMs: z.number(),
    connectedClients: z.number(),
  }),
  agents: z.object({
    running: z.number(),
    total: z.number(),
  }),
})

export const CodebaseMetricsSchema = z.object({
  lintWarnings: z.number(),
  lintErrors: z.number(),
  anyCount: z.number(),
  testFileCount: z.number(),
  totalFiles: z.number(),
  timestamp: z.number(),
})

export const CampaignSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["active", "completed", "paused"]),
  baselineMetrics: CodebaseMetricsSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const CampaignReportSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  baselineMetrics: CodebaseMetricsSchema,
  currentMetrics: CodebaseMetricsSchema,
  cardsCompleted: z.number(),
  cardsRemaining: z.number(),
  cardsBlocked: z.number(),
  delta: z.object({
    lintWarnings: z.number(),
    lintErrors: z.number(),
    anyCount: z.number(),
    testFileCount: z.number(),
  }),
  createdAt: z.number(),
})

export const SearchResultSchema = z.object({
  type: z.enum(["card", "document", "decision"]),
  id: z.string(),
  title: z.string(),
  snippet: z.string(),
  projectId: z.string().nullable(),
})

export const AuditEntrySchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  actor: z.string(),
  details: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
})

// ============================================================================
// API Response Wrappers
// ============================================================================

export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  })

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

// ============================================================================
// Request Body Schemas (for input validation)
// ============================================================================

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  color: z.string().optional(),
})

export const UpdateProjectRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["active", "archived", "paused"]).optional(),
  color: z.string().optional(),
  agentTimeoutMinutes: z.number().positive().optional(),
  maxConcurrentAgents: z.number().positive().optional(),
})

export const CreateCardRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  column: z.enum(["backlog", "in_progress", "done"]).default("backlog"),
  labels: z.array(z.string()).default([]),
  priority: z.number().default(0),
  dueDate: z.number().optional(),
  campaignId: z.string().optional(),
})

export const UpdateCardRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  column: z.enum(["backlog", "in_progress", "done"]).optional(),
  labels: z.array(z.string()).optional(),
  priority: z.number().optional(),
  dueDate: z.number().nullable().optional(),
  campaignId: z.string().nullable().optional(),
})

export const CreateDecisionRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  alternatives: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
  tradeoffs: z.string().default(""),
})

export const CreateSteeringRequestSchema = z.object({
  correction: z.string().min(1),
  domain: CorrectionDomainSchema,
  source: CorrectionSourceSchema.default("explicit"),
  context: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
})

export const SpawnAgentRequestSchema = z.object({
  cardId: z.string().min(1),
  projectId: z.string().min(1),
  agent: AgentTypeSchema.default("ollama"),
})

// ============================================================================
// Kanban Board Response (grouped by column)
// ============================================================================

export const KanbanBoardSchema = z.object({
  backlog: z.array(KanbanCardSchema),
  in_progress: z.array(KanbanCardSchema),
  done: z.array(KanbanCardSchema),
})
