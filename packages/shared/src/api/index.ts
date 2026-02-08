/**
 * API route definitions and types shared between server and client
 */

// REST API routes
export const API_ROUTES = {
  // Auth
  AUTH_TOKEN: "/api/auth/token",

  // Messages
  MESSAGES: "/api/messages",
  MESSAGES_BY_PROJECT: (projectId: string) => `/api/projects/${projectId}/messages`,

  // Projects
  PROJECTS: "/api/projects",
  PROJECT: (id: string) => `/api/projects/${id}`,

  // Project Documents
  PROJECT_DOCS: (projectId: string) => `/api/projects/${projectId}/docs`,
  PROJECT_DOC: (projectId: string, docId: string) => `/api/projects/${projectId}/docs/${docId}`,

  // Kanban
  KANBAN_CARDS: (projectId: string) => `/api/projects/${projectId}/cards`,
  KANBAN_CARD: (projectId: string, cardId: string) => `/api/projects/${projectId}/cards/${cardId}`,

  // Decisions
  DECISIONS: (projectId: string) => `/api/projects/${projectId}/decisions`,

  // Export
  PROJECT_EXPORT: (projectId: string) => `/api/projects/${projectId}/export`,

  // Conversations
  CONVERSATIONS: "/api/conversations",
  CONVERSATIONS_ACTIVE: "/api/conversations/active",

  // Voice
  VOICE_STATUS: "/api/voice/status",

  // Health
  HEALTH: "/api/health",

  // Search
  SEARCH: "/api/search",

  // Usage
  USAGE: "/api/usage",
} as const;

// WebSocket path
export const WS_PATH = "/ws";

// Auth header
export const AUTH_HEADER = "Authorization";

// Default server config
export const DEFAULT_SERVER_PORT = 3117;
export const DEFAULT_SERVER_HOST = "localhost";
