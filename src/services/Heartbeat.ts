/**
 * Heartbeat Module
 *
 * Broadcast function wiring for heartbeat/ping messages over WebSocket.
 * Set by AppServer when the WebSocket server is available.
 */

// Broadcast function type — set by AppServer when WebSocket is available
type BroadcastFn = (message: Record<string, unknown>) => void
let broadcast: BroadcastFn = () => {}

export function setHeartbeatBroadcast(fn: BroadcastFn) {
  broadcast = fn
}

export function getHeartbeatBroadcast(): BroadcastFn {
  return broadcast
}
