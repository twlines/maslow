/**
 * Shared route handler utilities
 */

import type { ServerResponse } from "http"

export const sendJson = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  })
  res.end(JSON.stringify(data))
}
