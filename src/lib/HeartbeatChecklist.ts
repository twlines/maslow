/**
 * Heartbeat Checklist Parser
 *
 * Reads HEARTBEAT.md and returns which features are enabled/disabled.
 * Users edit the file in plain English — checkbox syntax controls behavior.
 */

import * as fs from "fs"
import * as pathModule from "path"

export interface HeartbeatConfig {
  builder: {
    processBacklog: boolean
    retryBlocked: boolean
    skipInteractiveOnly: boolean
  }
  synthesizer: {
    mergeVerified: boolean
    collectMetrics: boolean
    crossProjectSynthesis: boolean
  }
  daily: {
    draftPRs: boolean
    sendDigest: boolean
    cleanWorktrees: boolean
  }
  notifications: {
    telegramSpawned: boolean
    telegramGate2: boolean
    telegramCampaign: boolean
    websocketEvents: boolean
    telegramDailySummary: boolean
  }
  constraints: {
    maxConcurrentAgents: number
    blockedRetryMinutes: number
    skipLargeContext: boolean
  }
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  builder: { processBacklog: true, retryBlocked: true, skipInteractiveOnly: false },
  synthesizer: { mergeVerified: true, collectMetrics: true, crossProjectSynthesis: false },
  daily: { draftPRs: true, sendDigest: false, cleanWorktrees: false },
  notifications: {
    telegramSpawned: true,
    telegramGate2: true,
    telegramCampaign: true,
    websocketEvents: true,
    telegramDailySummary: false,
  },
  constraints: { maxConcurrentAgents: 3, blockedRetryMinutes: 30, skipLargeContext: false },
}

const CHECKBOX_MAP: Record<string, [keyof HeartbeatConfig, string]> = {
  "process backlog kanban cards": ["builder", "processBacklog"],
  "retry blocked cards": ["builder", "retryBlocked"],
  "skip cards tagged": ["builder", "skipInteractiveOnly"],
  "merge branch-verified cards": ["synthesizer", "mergeVerified"],
  "collect campaign metrics": ["synthesizer", "collectMetrics"],
  "generate cross-project synthesis": ["synthesizer", "crossProjectSynthesis"],
  "draft prs for merge-verified": ["daily", "draftPRs"],
  "send daily digest": ["daily", "sendDigest"],
  "clean up stale worktrees": ["daily", "cleanWorktrees"],
  "telegram: agent spawned": ["notifications", "telegramSpawned"],
  "telegram: gate 2": ["notifications", "telegramGate2"],
  "telegram: campaign completed": ["notifications", "telegramCampaign"],
  "websocket: all heartbeat": ["notifications", "websocketEvents"],
  "telegram: daily summary": ["notifications", "telegramDailySummary"],
  "max concurrent agents": ["constraints", "maxConcurrentAgents"],
  "blocked retry interval": ["constraints", "blockedRetryMinutes"],
  "skip cards with context": ["constraints", "skipLargeContext"],
}

export const parseHeartbeatChecklist = (workspacePath: string): HeartbeatConfig => {
  const filePath = pathModule.join(workspacePath, "HEARTBEAT.md")

  if (!fs.existsSync(filePath)) {
    return DEFAULT_CONFIG
  }

  const content = fs.readFileSync(filePath, "utf-8")
  const config = structuredClone(DEFAULT_CONFIG)

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    const enabledMatch = trimmed.match(/^-\s*\[x\]\s*(.+)/i)
    const disabledMatch = trimmed.match(/^-\s*\[ \]\s*(.+)/i)

    if (!enabledMatch && !disabledMatch) continue

    const enabled = !!enabledMatch
    const text = (enabledMatch?.[1] ?? disabledMatch?.[1] ?? "").toLowerCase()

    for (const [pattern, [section, key]] of Object.entries(CHECKBOX_MAP)) {
      if (text.includes(pattern)) {
        const sectionObj = config[section] as Record<string, boolean | number>
        if (typeof sectionObj[key] === "boolean") {
          sectionObj[key] = enabled
        } else if (typeof sectionObj[key] === "number" && key === "maxConcurrentAgents") {
          const numMatch = text.match(/:\s*(\d+)/)
          if (numMatch) sectionObj[key] = parseInt(numMatch[1], 10)
        } else if (typeof sectionObj[key] === "number" && key === "blockedRetryMinutes") {
          const numMatch = text.match(/:\s*(\d+)/)
          if (numMatch) sectionObj[key] = parseInt(numMatch[1], 10)
        }
        break
      }
    }
  }

  return config
}
