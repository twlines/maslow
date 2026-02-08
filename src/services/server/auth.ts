/**
 * Authentication utilities for the Maslow HTTP/WS server.
 *
 * Provides JWT signing/verification, request authentication,
 * and auth endpoint handlers (token exchange + refresh).
 */

import type { IncomingMessage, ServerResponse } from "http"
import jwt from "jsonwebtoken"
import { sendJson, readBody } from "./router.js"

// ── Constants ──

export const AUTH_TOKEN_HEADER = "authorization"
export const JWT_EXPIRY_SECONDS = 24 * 60 * 60 // 24 hours
const JWT_SUBJECT = "maslow"

// ── JWT utilities ──

/**
 * Sign a new JWT token.
 * Returns the token string and its expiry timestamp (Unix seconds).
 */
export function signJwt(secret: string): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS
  const token = jwt.sign({ sub: JWT_SUBJECT }, secret, { expiresIn: JWT_EXPIRY_SECONDS })
  return { token, expiresAt }
}

/**
 * Verify a JWT token against the auth secret.
 * Returns the decoded payload on success, null on failure.
 */
export function verifyJwt(token: string, secret: string): jwt.JwtPayload | null {
  try {
    const payload = jwt.verify(token, secret)
    if (typeof payload === "string") return null
    return payload
  } catch {
    return null
  }
}

// ── Request authentication ──

/**
 * Authenticate an incoming HTTP request using a 3-tier strategy:
 *
 * 1. If no authToken is configured (dev mode), accept all requests
 * 2. Check Authorization header for Bearer token:
 *    - Raw secret match (backwards-compatible)
 *    - JWT verification
 * 3. Fall back to ?token= query parameter (used by WebSocket clients)
 */
export function authenticate(
  req: IncomingMessage,
  authToken: string,
  baseUrl: string
): boolean {
  if (!authToken) return true // No auth configured = open (dev mode)

  // Check Authorization header
  const header = req.headers[AUTH_TOKEN_HEADER]
  if (header && typeof header === "string") {
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (bearer) {
      // Accept raw secret directly
      if (bearer === authToken) return true
      // Try JWT verification
      try {
        jwt.verify(bearer, authToken)
        return true
      } catch { /* invalid JWT */ }
    }
  }

  // Fall back to ?token= query param (used by WebSocket clients)
  try {
    const url = new URL(req.url || "/", baseUrl)
    const queryToken = url.searchParams.get("token")
    if (queryToken === authToken) return true
  } catch { /* ignore malformed URLs */ }

  return false
}

// ── Auth endpoint handlers ──

/**
 * POST /api/auth/token — exchange a raw secret for a JWT.
 *
 * Request body: { token: string }
 * Success: 200 { ok: true, data: { authenticated: true, token, expiresAt } }
 * Invalid: 401 { ok: false, error: "Invalid token" }
 * Malformed: 400 { ok: false, error: "Invalid request body" }
 */
export async function handleAuthToken(
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req))
    if (body.token === authToken) {
      const { token, expiresAt } = signJwt(authToken)
      sendJson(res, 200, { ok: true, data: { authenticated: true, token, expiresAt } })
    } else {
      sendJson(res, 401, { ok: false, error: "Invalid token" })
    }
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid request body" })
  }
}

/**
 * POST /api/auth/refresh — refresh a valid JWT for a new one.
 *
 * Requires Authorization header with a valid Bearer JWT.
 * Success: 200 { ok: true, data: { token, expiresAt } }
 * Missing header: 401
 * Invalid/expired: 401
 */
export async function handleAuthRefresh(
  _req: IncomingMessage,
  res: ServerResponse,
  authToken: string,
  authHeader: string | string[] | undefined
): Promise<void> {
  const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (!bearer || !bearer.startsWith("Bearer ")) {
    sendJson(res, 401, { ok: false, error: "Missing Authorization header" })
    return
  }
  const incoming = bearer.slice(7)
  const payload = verifyJwt(incoming, authToken)
  if (!payload) {
    sendJson(res, 401, { ok: false, error: "Invalid or expired token" })
    return
  }
  const { token, expiresAt } = signJwt(authToken)
  sendJson(res, 200, { ok: true, data: { token, expiresAt } })
}
