// Core types shared between server and client

export interface Message {
  id: string;
  projectId: string | null;
  conversationId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  projectId: string | null;
  claudeSessionId: string;
  status: "active" | "archived";
  contextUsagePercent: number;
  summary: string | null;
  messageCount: number;
  firstMessageAt: number;
  lastMessageAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "paused";
  createdAt: number;
  updatedAt: number;
  color?: string;
  agentTimeoutMinutes?: number;
  maxConcurrentAgents?: number;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  type: "brief" | "instructions" | "reference" | "decisions" | "assumptions" | "state";
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentType = "ollama" | "codex" | "gemini";
export type AgentStatus = "idle" | "running" | "blocked" | "completed" | "failed";

// Verification — two-gate system for agent work
export type VerificationStatus =
  | "unverified"        // Agent completed, not yet checked
  | "branch_verified"   // Gate 1 passed (tsc + lint + test on branch)
  | "branch_failed"     // Gate 1 failed
  | "merge_verified"    // Gate 2 passed (checks pass on integration branch post-merge)
  | "merge_failed"      // Gate 2 failed

export interface KanbanCard {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: "backlog" | "in_progress" | "done";
  labels: string[];
  dueDate?: number;
  linkedDecisionIds: string[];
  linkedMessageIds: string[];
  position: number;
  priority: number;
  contextSnapshot: string | null;
  lastSessionId: string | null;
  assignedAgent: AgentType | null;
  agentStatus: AgentStatus | null;
  blockedReason: string | null;
  startedAt: number | null;
  completedAt: number | null;
  verificationStatus: VerificationStatus | null;
  campaignId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  id: string;
  projectId: string;
  title: string;
  description: string;
  alternatives: string[];
  reasoning: string;
  tradeoffs: string;
  createdAt: number;
  revisedAt?: number;
}

// Tool activity — real-time visibility into agent tool use
export interface ChatToolActivity {
  id: string
  toolName: string
  summary: string
  status: "running" | "completed" | "error"
  timestamp: number
}

// WebSocket message types
export type WSClientMessage =
  | { type: "chat"; content: string; projectId?: string }
  | { type: "voice"; audio: string; projectId?: string } // base64 encoded
  | { type: "subscribe"; projectId: string }
  | { type: "ping" };

export type WSServerMessage =
  | { type: "chat.stream"; content: string; messageId: string }
  | { type: "chat.complete"; messageId: string; message: Message }
  | { type: "chat.tool_call"; name: string; input: string }
  | { type: "chat.tool_activity"; messageId: string; activity: ChatToolActivity }
  | { type: "chat.error"; error: string }
  | { type: "chat.handoff"; message: string }
  | { type: "chat.handoff_complete"; conversationId: string; message: string }
  | { type: "chat.transcription"; messageId: string; text: string }
  | { type: "chat.audio"; messageId: string; audio: string; format: string }
  | { type: "workspace.action"; action: string; data: Record<string, unknown> }
  | { type: "presence"; state: "idle" | "thinking" | "speaking" }
  | { type: "pong" }
  | { type: "ping" }
  | { type: "card.assigned"; cardId: string; agent: AgentType }
  | { type: "card.status"; cardId: string; status: AgentStatus; reason?: string }
  | { type: "agent.log"; cardId: string; line: string }
  | { type: "agent.spawned"; cardId: string; agent: AgentType }
  | { type: "agent.completed"; cardId: string }
  | { type: "agent.failed"; cardId: string; error: string }
  | { type: "agent.stopped"; cardId: string; projectId: string }
  | { type: "system.heartbeat"; tick: number; agents: number; uptime: number }
  | { type: "system.synthesizer"; completed: number; blocked: number; timestamp: number }
  | { type: "verification.started"; cardId: string; gate: "branch" | "merge" }
  | { type: "verification.passed"; cardId: string; gate: "branch" | "merge" }
  | { type: "verification.failed"; cardId: string; gate: "branch" | "merge"; output: string }
  | { type: "campaign.report"; campaignId: string; report: CampaignReport };

// Steering corrections
export type CorrectionDomain = "code-pattern" | "communication" | "architecture" | "preference" | "style" | "process";
export type CorrectionSource = "explicit" | "pr-rejection" | "edit-delta" | "agent-feedback";

export interface SteeringCorrection {
  id: string;
  correction: string;
  domain: CorrectionDomain;
  source: CorrectionSource;
  context: string | null;
  projectId: string | null;
  active: boolean;
  createdAt: number;
}

// Health check
export interface HealthStatus {
  status: "ok"
  uptime: number
  timestamp: number
  heartbeat: {
    intervalMs: number
    connectedClients: number
  }
  agents: {
    running: number
    total: number
  }
}

// Token usage tracking
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

// Usage summary
export interface UsageSummary {
  total: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
  byProject: Array<{
    projectId: string
    projectName: string
    totalCost: number
    cardCount: number
  }>
  recentMessages: Array<{
    messageId: string
    projectId: string | null
    cost: number
    inputTokens: number
    outputTokens: number
    timestamp: number
  }>
}

// Search functionality
export interface SearchResult {
  type: "card" | "document" | "decision"
  id: string
  title: string
  snippet: string
  projectId: string | null
}

// Audit logging
export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  actor: string
  details: Record<string, unknown>
  timestamp: number
}

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  limit?: number
  offset?: number
}

// API response types
export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
}

// Codebase health metrics — snapshot at a point in time
export interface CodebaseMetrics {
  lintWarnings: number
  lintErrors: number
  anyCount: number
  testFileCount: number
  totalFiles: number
  timestamp: number
}

// Campaign — a batch of related kanban cards with tracked metrics
export interface Campaign {
  id: string
  projectId: string
  name: string
  description: string
  status: "active" | "completed" | "paused"
  baselineMetrics: CodebaseMetrics | null
  createdAt: number
  updatedAt: number
}

// Campaign report — metrics delta at a point in time
export interface CampaignReport {
  id: string
  campaignId: string
  baselineMetrics: CodebaseMetrics
  currentMetrics: CodebaseMetrics
  cardsCompleted: number
  cardsRemaining: number
  cardsBlocked: number
  delta: {
    lintWarnings: number
    lintErrors: number
    anyCount: number
    testFileCount: number
  }
  createdAt: number
}

// Skills — prompt-layer extensions that teach agents how to do things
export type SkillScope = "ollama" | "claude" | "both"
export type SkillDomain = "code" | "project" | "thinking" | "ops"

export interface Skill {
  name: string
  description: string
  scope: SkillScope
  domain: SkillDomain
  requires: string[]
  contextBudget: number
  content: string
  filePath: string
}

// Verification result from running checks on a worktree
export interface VerificationResult {
  gate: "branch" | "merge"
  passed: boolean
  tscOutput: string
  lintOutput: string
  testOutput: string
  timestamp: number
  cardId: string
  branchName: string
}

// V2P Governance — flow-level contract state
export type RiskTier = "T1" | "T2" | "T3" | "T4" | "T5"
export type MaturityLevel = "L0" | "L1" | "L2" | "L3" | "L4"
export type FlowPriority = "P0" | "P1" | "P2" | "P3"
export type StalenessStatus = "fresh" | "stale" | "unknown"

export interface GovernanceClause {
  id: string
  dimension: string
  text: string
}

export interface GovernanceFlow {
  id: string
  projectId: string
  flowName: string
  sourceFile: string
  riskTier: RiskTier
  maturity: MaturityLevel
  priority: FlowPriority
  dimensions: string[]
  clauses: GovernanceClause[]
  collections: string[]
  externalServices: string[]
  dataCategories: string[]
  reviewIssue: string | null
  hardeningIssue: string | null
  gitHash: string
  staleness: StalenessStatus
  syncedAt: number
}

export type GateStatus = "pass" | "fail"

export interface GateCriterion {
  id: string
  projectId: string
  criterionNumber: number
  label: string
  status: GateStatus
  evidence: string | null
  updatedAt: number
}

export interface GovernanceSummary {
  maturityCounts: Record<MaturityLevel, number>
  totalFlows: number
  totalClauses: number
  riskTierCounts: Record<RiskTier, number>
  gate: {
    passing: number
    total: number
    status: "GO" | "NO-GO"
  }
}
