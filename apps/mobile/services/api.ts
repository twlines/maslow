/**
 * Maslow API client — WebSocket + REST
 *
 * Connects to the Maslow server for real-time chat and data access.
 */

import { Platform } from "react-native";

// Server config — defaults for local dev
const DEFAULT_HOST = Platform.OS === "web" ? "localhost" : "localhost";
const DEFAULT_PORT = 3117;

let serverUrl = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
let wsUrl = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}/ws`;
let authToken = "";

export function configure(opts: { host?: string; port?: number; token?: string }) {
  const host = opts.host || DEFAULT_HOST;
  const port = opts.port || DEFAULT_PORT;
  serverUrl = `http://${host}:${port}`;
  wsUrl = `ws://${host}:${port}/ws`;
  if (opts.token) authToken = opts.token;
}

// ---- REST API ----

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "API request failed");
  }
  return data.data;
}

export const api = {
  getMessages: (projectId?: string, limit = 50, offset = 0) =>
    apiFetch<any[]>(`/api/messages?${new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      limit: String(limit),
      offset: String(offset),
    })}`),

  getProjects: () => apiFetch<any[]>("/api/projects"),

  createProject: (name: string, description = "") =>
    apiFetch<any>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),

  getProject: (id: string) => apiFetch<any>(`/api/projects/${id}`),

  updateProject: (id: string, updates: Record<string, any>) =>
    apiFetch<any>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  getProjectDocs: (projectId: string) =>
    apiFetch<any[]>(`/api/projects/${projectId}/docs`),

  createProjectDoc: (projectId: string, type: string, title: string, content: string) =>
    apiFetch<any>(`/api/projects/${projectId}/docs`, {
      method: "POST",
      body: JSON.stringify({ type, title, content }),
    }),

  updateProjectDoc: (projectId: string, docId: string, updates: Record<string, any>) =>
    apiFetch<any>(`/api/projects/${projectId}/docs/${docId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  getBoard: (projectId: string) =>
    apiFetch<any>(`/api/projects/${projectId}/cards`),

  createCard: (projectId: string, title: string, description = "", column = "backlog") =>
    apiFetch<any>(`/api/projects/${projectId}/cards`, {
      method: "POST",
      body: JSON.stringify({ title, description, column }),
    }),

  updateCard: (projectId: string, cardId: string, updates: Record<string, any>) =>
    apiFetch<any>(`/api/projects/${projectId}/cards/${cardId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  deleteCard: (projectId: string, cardId: string) =>
    apiFetch<any>(`/api/projects/${projectId}/cards/${cardId}`, {
      method: "DELETE",
    }),

  getDecisions: (projectId: string) =>
    apiFetch<any[]>(`/api/projects/${projectId}/decisions`),

  createDecision: (projectId: string, data: Record<string, any>) =>
    apiFetch<any>(`/api/projects/${projectId}/decisions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ---- WebSocket ----

export type PresenceState = "idle" | "thinking" | "speaking";

export interface WSCallbacks {
  onStream?: (content: string, messageId: string) => void;
  onComplete?: (messageId: string, message: any) => void;
  onToolCall?: (name: string, input: string) => void;
  onError?: (error: string) => void;
  onPresence?: (state: PresenceState) => void;
  onTranscription?: (messageId: string, text: string) => void;
  onAudio?: (messageId: string, audioBase64: string, format: string) => void;
  onHandoff?: (message: string) => void;
  onHandoffComplete?: (conversationId: string, message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

let ws: WebSocket | null = null;
let callbacks: WSCallbacks = {};
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function setCallbacks(cbs: WSCallbacks) {
  callbacks = cbs;
}

export function connect() {
  if (ws?.readyState === WebSocket.OPEN) return;

  const url = authToken ? `${wsUrl}?token=${authToken}` : wsUrl;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[WS] Connected");
    callbacks.onOpen?.();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      switch (msg.type) {
        case "chat.stream":
          callbacks.onStream?.(msg.content, msg.messageId);
          break;
        case "chat.complete":
          callbacks.onComplete?.(msg.messageId, msg.message);
          break;
        case "chat.tool_call":
          callbacks.onToolCall?.(msg.name, msg.input);
          break;
        case "chat.error":
          callbacks.onError?.(msg.error);
          break;
        case "presence":
          callbacks.onPresence?.(msg.state);
          break;
        case "chat.transcription":
          callbacks.onTranscription?.(msg.messageId, msg.text);
          break;
        case "chat.audio":
          callbacks.onAudio?.(msg.messageId, msg.audio, msg.format);
          break;
        case "chat.handoff":
          callbacks.onHandoff?.(msg.message);
          break;
        case "chat.handoff_complete":
          callbacks.onHandoffComplete?.(msg.conversationId, msg.message);
          break;
        case "pong":
          break;
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected");
    callbacks.onClose?.();
    ws = null;
    // Auto-reconnect after 3 seconds
    reconnectTimer = setTimeout(() => connect(), 3000);
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
  };
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function sendChat(content: string, projectId?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    callbacks.onError?.("Not connected to server");
    return;
  }
  ws.send(JSON.stringify({
    type: "chat",
    content,
    ...(projectId ? { projectId } : {}),
  }));
}

export function sendVoice(audioBase64: string, projectId?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    callbacks.onError?.("Not connected to server");
    return;
  }
  ws.send(JSON.stringify({
    type: "voice",
    audio: audioBase64,
    ...(projectId ? { projectId } : {}),
  }));
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
