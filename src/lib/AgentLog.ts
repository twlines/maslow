/**
 * Agent Log
 *
 * Append-only daily log of all agent actions. Inspired by OpenClaw's
 * memory/YYYY-MM-DD.md pattern. Each day gets its own file.
 *
 * These logs are human-readable markdown — review what the agent did,
 * what it learned, and what failed.
 */

import * as fs from "fs"
import * as pathModule from "path"

const LOG_DIR = "memory"

const getLogPath = (workspacePath: string): string => {
  const date = new Date().toISOString().split("T")[0]
  return pathModule.join(workspacePath, LOG_DIR, `${date}.md`)
}

const ensureLogDir = (workspacePath: string): void => {
  const dir = pathModule.join(workspacePath, LOG_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const timestamp = (): string => {
  return new Date().toISOString().split("T")[1].split(".")[0]
}

export const agentLog = {
  /** Append a line to today's agent log */
  append(workspacePath: string, entry: string): void {
    ensureLogDir(workspacePath)
    const logPath = getLogPath(workspacePath)

    // Create header if new file
    if (!fs.existsSync(logPath)) {
      const date = new Date().toISOString().split("T")[0]
      fs.writeFileSync(logPath, `# Agent Log — ${date}\n\n`, "utf-8")
    }

    fs.appendFileSync(logPath, `- \`${timestamp()}\` ${entry}\n`, "utf-8")
  },

  /** Log an agent spawn */
  spawned(workspacePath: string, cardTitle: string, model: string, projectName: string): void {
    agentLog.append(workspacePath, `**Spawned** agent on "${cardTitle}" (${model}, ${projectName})`)
  },

  /** Log a verification result */
  verified(workspacePath: string, cardTitle: string, passed: boolean, gate: string): void {
    const status = passed ? "PASSED" : "FAILED"
    agentLog.append(workspacePath, `**${gate} ${status}** — "${cardTitle}"`)
  },

  /** Log a card completion */
  completed(workspacePath: string, cardTitle: string, filesModified: string[], retryCount: number): void {
    const retries = retryCount > 0 ? ` (${retryCount} retries)` : ""
    agentLog.append(workspacePath, `**Completed** "${cardTitle}" — ${filesModified.length} files modified${retries}`)
  },

  /** Log a card blocked */
  blocked(workspacePath: string, cardTitle: string, reason: string): void {
    agentLog.append(workspacePath, `**Blocked** "${cardTitle}" — ${reason}`)
  },

  /** Log a heartbeat tick */
  tick(workspacePath: string, projectsScanned: number, spawned: number, queued: number): void {
    agentLog.append(workspacePath, `Heartbeat tick: ${projectsScanned} projects, ${spawned} spawned, ${queued} queued`)
  },

  /** Log a synthesizer run */
  synthesized(workspacePath: string, merged: number, failed: number): void {
    agentLog.append(workspacePath, `Synthesizer: ${merged} merged, ${failed} failed`)
  },

  /** Log a path traversal block */
  securityBlock(workspacePath: string, cardId: string, path: string): void {
    agentLog.append(workspacePath, `**SECURITY** Path traversal blocked on card ${cardId}: "${path}"`)
  },

  /** Read today's log (for briefings) */
  readToday(workspacePath: string): string | null {
    const logPath = getLogPath(workspacePath)
    if (!fs.existsSync(logPath)) return null
    return fs.readFileSync(logPath, "utf-8")
  },

  /** Read yesterday's log (for context loading) */
  readYesterday(workspacePath: string): string | null {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0]
    const logPath = pathModule.join(workspacePath, LOG_DIR, `${yesterday}.md`)
    if (!fs.existsSync(logPath)) return null
    return fs.readFileSync(logPath, "utf-8")
  },
}
