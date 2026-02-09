/**
 * Auth Middleware
 *
 * Pure functions for JWT validation, token generation, and auth checking.
 * Extracted from AppServer for reuse and testability.
 */

import jwt from "jsonwebtoken"
import type { IncomingMessage } from "http"

// Auth header key (Node normalizes to lowercase)
export const AUTH_TOKEN_HEADER = "authorization"

// Default JWT expiry: 24 hours
export const JWT_EXPIRY_SECONDS = 24 * 60 * 60

/**
 * Extract the bearer token from an Authorization header value.
 * Returns null if the header is missing or not in "Bearer <token>" format.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header || typeof header !== "string") return null
  if (!header.startsWith("Bearer ")) return null
  const token = header.slice(7)
  return token || null
}

/**
 * Validate a JWT token against a secret.
 * Returns the decoded payload on success, null on failure.
 */
export function validateToken(token: string, secret: string): jwt.JwtPayload | null {
  try {
    const payload = jwt.verify(token, secret)
    if (typeof payload === "string") return null
    return payload
  } catch {
    return null
  }
}

/**
 * Generate a signed JWT token.
 * Returns the token string and its expiration timestamp (Unix seconds).
 */
export function generateToken(
  secret: string,
  expirySeconds: number = JWT_EXPIRY_SECONDS
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds
  const token = jwt.sign({ sub: "maslow" }, secret, { expiresIn: expirySeconds })
  return { token, expiresAt }
}

/**
 * Authenticate an incoming HTTP request.
 *
 * Checks in order:
 * 1. If no authToken configured, returns true (dev mode)
 * 2. Authorization header — accepts raw secret or valid JWT
 * 3. ?token= query parameter — accepts raw secret
 */
export function authenticateRequest(
  req: IncomingMessage,
  authToken: string,
  port: number
): boolean {
  if (!authToken) return true // No auth configured = open (dev mode)

  // Check Authorization header
  const header = req.headers[AUTH_TOKEN_HEADER]
  if (header && typeof header === "string") {
    const bearer = extractBearerToken(header)
    if (bearer) {
      // Accept raw secret directly
      if (bearer === authToken) return true
      // Try JWT verification
      if (validateToken(bearer, authToken)) return true
    }
  }

  // Fall back to ?token= query param (used by WebSocket clients)
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`)
    const queryToken = url.searchParams.get("token")
    if (queryToken === authToken) return true
  } catch { /* ignore malformed URLs */ }

  return false
}
