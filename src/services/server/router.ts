/**
 * Declarative HTTP Router
 *
 * Replaces sequential if/regex matching in handleRequest with a
 * declarative route table. Each route specifies method, pattern,
 * and handler. Path parameters are extracted automatically from
 * regex capture groups.
 */

import type { IncomingMessage, ServerResponse } from "http"

// ── Types ──

/** Extracted path parameters from regex capture groups */
export type Params = Record<string, string>

/** Handler function for a matched route */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
) => Promise<void>

/** Context passed to route handlers */
export interface RouteContext {
  /** Extracted path parameters (from regex capture groups) */
  params: Params
  /** Parsed URL search params */
  searchParams: URLSearchParams
  /** The matched pathname */
  path: string
  /** HTTP method */
  method: string
}

/** A single route definition */
export interface Route {
  /** HTTP method to match (GET, POST, PUT, DELETE) */
  method: string
  /**
   * URL pattern to match against the pathname.
   * - string: exact match
   * - RegExp: regex match with named or positional capture groups
   */
  pattern: string | RegExp
  /** Handler function called when the route matches */
  handler: RouteHandler
  /**
   * Named parameter keys for positional regex capture groups.
   * e.g. ["projectId", "cardId"] maps $1 → params.projectId, $2 → params.cardId
   */
  paramNames?: string[]
}

// ── Utilities ──

/** Send a JSON response with standard CORS headers */
export const sendJson = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  })
  res.end(JSON.stringify(data))
}

/** Read the full request body as a string */
export const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString()))
    req.on("error", reject)
  })

/** Read the full request body as a raw Buffer */
export const readBodyRaw = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })

/**
 * Extract path parameters from a regex match.
 *
 * If paramNames are provided, maps capture groups to named params:
 *   match[1] → params[paramNames[0]], match[2] → params[paramNames[1]], etc.
 *
 * Falls back to positional keys: "0", "1", "2", etc.
 */
export function extractParams(
  match: RegExpExecArray,
  paramNames?: string[]
): Params {
  const params: Params = {}
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) {
      const key = paramNames?.[i - 1] ?? String(i - 1)
      params[key] = match[i]
    }
  }
  return params
}

// ── Router ──

/**
 * Create a router function from a route table.
 *
 * Returns an async function that tries each route in order.
 * Returns `true` if a route matched and was handled, `false` otherwise.
 *
 * @param routes - Ordered array of route definitions
 * @param baseUrl - Base URL for parsing (e.g. "http://localhost:3117")
 */
export function createRouter(
  routes: Route[],
  baseUrl: string
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = new URL(req.url || "/", baseUrl)
    const path = url.pathname
    const method = req.method || "GET"

    for (const route of routes) {
      // Method check
      if (route.method !== method) continue

      // Pattern matching
      let params: Params = {}

      if (typeof route.pattern === "string") {
        // Exact string match
        if (path !== route.pattern) continue
      } else {
        // Regex match
        const match = route.pattern.exec(path)
        if (!match) continue
        params = extractParams(match, route.paramNames)
      }

      // Route matched — invoke handler
      await route.handler(req, res, {
        params,
        searchParams: url.searchParams,
        path,
        method,
      })
      return true
    }

    return false
  }
}
