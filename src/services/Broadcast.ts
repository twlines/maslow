/**
 * Broadcast Service
 *
 * Provides a typed broadcast channel for pushing messages to WebSocket clients.
 * AgentOrchestrator and Heartbeat depend on this service instead of using
 * module-level mutable state setters.
 *
 * AppServer calls setAgentHandler / setHeartbeatHandler once the WebSocket
 * server is ready — before that, messages are silently dropped (no-op).
 */

import { Context, Layer } from "effect"

export type BroadcastFn = (message: Record<string, unknown>) => void

export interface BroadcastService {
  /** Send a message through the agent broadcast channel */
  agentBroadcast: BroadcastFn

  /** Send a message through the heartbeat broadcast channel */
  heartbeatBroadcast: BroadcastFn

  /** Set the handler for agent broadcast messages (called by AppServer) */
  setAgentHandler(fn: BroadcastFn): void

  /** Set the handler for heartbeat broadcast messages (called by AppServer) */
  setHeartbeatHandler(fn: BroadcastFn): void
}

export class Broadcast extends Context.Tag("Broadcast")<
  Broadcast,
  BroadcastService
>() {}

export const BroadcastLive = Layer.sync(Broadcast, () => {
  let agentHandler: BroadcastFn = () => {}
  let heartbeatHandler: BroadcastFn = () => {}

  return {
    agentBroadcast: (message: Record<string, unknown>) => agentHandler(message),
    heartbeatBroadcast: (message: Record<string, unknown>) => heartbeatHandler(message),
    setAgentHandler: (fn: BroadcastFn) => { agentHandler = fn },
    setHeartbeatHandler: (fn: BroadcastFn) => { heartbeatHandler = fn },
  }
})
