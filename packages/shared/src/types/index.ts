// Core types shared between server and client

export interface Message {
  id: string;
  projectId: string | null;
  conversationId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  metadata?: {
    voiceNote?: boolean;
    toolCalls?: number;
    cost?: number;
    tokens?: { input: number; output: number };
  };
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

export type AgentType = "claude" | "codex" | "gemini";
export type AgentStatus = "idle" | "running" | "blocked" | "completed" | "failed";

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

// WebSocket message types
export type WSClientMessage =
  | { type: "chat"; content: string; projectId?: string }
  | { type: "voice"; audio: string; projectId?: string } // base64 encoded
  | { type: "ping" };

export type WSServerMessage =
  | { type: "chat.stream"; content: string; messageId: string }
  | { type: "chat.complete"; messageId: string; message: Message }
  | { type: "chat.tool_call"; name: string; input: string }
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
  | { type: "system.heartbeat"; tick: number; agents: number; uptime: number };

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

// API response types
export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
}
