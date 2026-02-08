/**
 * Agent Process Manager
 *
 * Handles spawning CLI agents, parsing stdout/stderr streams,
 * timeout enforcement, and process lifecycle (exit, error, cleanup).
 */

import { Effect } from "effect"
import { spawn, execSync, type ChildProcess } from "child_process"
import type { AgentType } from "../AppPersistence.js"
import type { AgentProcess, ProcessManagerDeps } from "./types.js"
import { removeWorktree } from "./worktree.js"

const MAX_LOG_LINES = 500

export function buildAgentCommand(agent: AgentType, prompt: string): { cmd: string; args: string[] } {
  switch (agent) {
    case "claude":
      return {
        cmd: "claude",
        args: [
          "-p",
          "--verbose",
          "--output-format", "stream-json",
          "--permission-mode", "bypassPermissions",
          "--max-turns", "50",
          prompt,
        ],
      }
    case "codex":
      return {
        cmd: "codex",
        args: ["--approval-mode", "full-auto", "-q", prompt],
      }
    case "gemini":
      return {
        cmd: "gemini",
        args: ["-y", prompt],
      }
  }
}

interface SpawnOptions {
  agentProcess: AgentProcess
  cmd: string
  args: string[]
  worktreeDir: string
  cwd: string
  agentTimeoutMs: number
  card: { title: string; description: string }
  deps: ProcessManagerDeps
}

function createLogger(agentProcess: AgentProcess, broadcast: (msg: Record<string, unknown>) => void) {
  return (line: string) => {
    agentProcess.logs.push(line)
    if (agentProcess.logs.length > MAX_LOG_LINES) {
      agentProcess.logs.shift()
    }
    broadcast({ type: "agent.log", cardId: agentProcess.cardId, projectId: agentProcess.projectId, line })
  }
}

export function spawnAgentProcess(opts: SpawnOptions): ChildProcess {
  const { agentProcess, cmd, args, worktreeDir, cwd, agentTimeoutMs, card, deps } = opts
  const { kanban, db, telegram, chatId, broadcast } = deps
  const addLog = createLogger(agentProcess, broadcast)

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const child = spawn(cmd, args, {
    cwd: worktreeDir,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env,
  })

  agentProcess.process = child

  // Close stdin — Claude CLI blocks on open stdin pipe
  child.stdin?.end()

  // Stream stdout (JSONL from --output-format stream-json)
  let stdoutBuffer = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split("\n")
    stdoutBuffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      addLog(line)

      try {
        const message = JSON.parse(line)
        if (message.type === "result" && message.modelUsage) {
          const modelUsage = Object.values(message.modelUsage)[0] as Record<string, number> | undefined
          if (modelUsage) {
            Effect.runPromise(
              db.insertTokenUsage({
                cardId: agentProcess.cardId,
                projectId: agentProcess.projectId,
                agent: agentProcess.agent,
                inputTokens: modelUsage.inputTokens || 0,
                outputTokens: modelUsage.outputTokens || 0,
                cacheReadTokens: modelUsage.cacheReadInputTokens || 0,
                cacheWriteTokens: modelUsage.cacheCreationInputTokens || 0,
                costUsd: message.total_cost_usd ?? 0,
                createdAt: Date.now(),
              })
            ).catch((err) => {
              addLog(`[orchestrator] Failed to save token usage: ${err}`)
            })
          }
        }
      } catch {
        // Not valid JSON — normal for non-JSON log lines
      }
    }
  })

  // Stream stderr
  let stderrBuffer = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
    const lines = stderrBuffer.split("\n")
    stderrBuffer = lines.pop() || ""
    for (const line of lines) {
      if (line.trim()) addLog(`[stderr] ${line}`)
    }
  })

  const cleanupWorktree = () => removeWorktree(cwd, worktreeDir)

  const notifyFailure = (reason: string) => {
    const stderrTail = agentProcess.logs
      .filter(l => l.startsWith("[stderr]"))
      .slice(-20)
      .join("\n")
    const msg = `🔴 Agent failed on "${card.title}"\n\nReason: ${reason}${stderrTail ? `\n\nLast stderr:\n\`\`\`\n${stderrTail.slice(0, 500)}\n\`\`\`` : ""}`
    Effect.runPromise(
      telegram.sendMessage(chatId, msg).pipe(Effect.ignore)
    ).catch(() => {})
  }

  // Agent timeout — kill after configured duration
  const timeoutTimer = setTimeout(() => {
    if (agentProcess.status === "running" && child && !child.killed) {
      agentProcess.status = "failed"
      const reason = `Timed out after ${agentTimeoutMs / 60000} minutes`
      addLog(`[orchestrator] ${reason}`)
      broadcast({ type: "agent.timeout", cardId: agentProcess.cardId })
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL")
      }, 5000)

      Effect.runPromise(
        Effect.gen(function* () {
          yield* kanban.updateAgentStatus(agentProcess.cardId, "failed", "Agent timed out")
          yield* db.logAudit("agent", agentProcess.cardId, "agent.timeout", {
            cardId: agentProcess.cardId,
            agent: agentProcess.agent,
            timeoutMs: agentTimeoutMs,
          })
        })
      ).catch(console.error)
    }
  }, agentTimeoutMs)

  // Handle process exit
  child.on("close", (code) => {
    clearTimeout(timeoutTimer)
    if (code === 0) {
      agentProcess.status = "completed"
      addLog(`[orchestrator] Agent completed successfully`)
      broadcast({ type: "agent.completed", cardId: agentProcess.cardId, projectId: agentProcess.projectId })

      Effect.runPromise(
        Effect.gen(function* () {
          yield* kanban.completeWork(agentProcess.cardId)
          yield* kanban.saveContext(agentProcess.cardId, `Agent ${agentProcess.agent} completed. Branch: ${agentProcess.branchName}`)
          yield* db.logAudit("agent", agentProcess.cardId, "agent.completed", {
            cardId: agentProcess.cardId,
            agent: agentProcess.agent,
            branchName: agentProcess.branchName,
          })
          yield* telegram.sendMessage(
            chatId,
            `✅ Agent completed "${card.title}" (branch: ${agentProcess.branchName})`
          ).pipe(Effect.ignore)
        })
      ).then(async () => {
        // Check gh auth before attempting push/PR
        try {
          execSync("gh auth status", { stdio: "pipe" })
        } catch {
          addLog("[orchestrator] gh not authenticated — skipping PR creation")
          return
        }

        const MAX_RETRIES = 3
        const RETRY_DELAY_MS = 5000
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            execSync(`git push -u origin ${agentProcess.branchName}`, { cwd: worktreeDir, stdio: "pipe" })
            const prTitle = card.title.slice(0, 70)
            const prBody = `## Card\n${card.title}\n\n## Description\n${card.description}\n\n## Agent\n${agentProcess.agent}\n\nSee \`verification-prompt.md\` for verification criteria.`
            execSync(`gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --head ${agentProcess.branchName}`, {
              cwd: worktreeDir,
              stdio: "pipe",
            })
            addLog(`[orchestrator] PR created on branch ${agentProcess.branchName}`)
            break
          } catch (err) {
            addLog(`[orchestrator] Push/PR attempt ${attempt}/${MAX_RETRIES} failed: ${err}`)
            if (attempt < MAX_RETRIES) {
              addLog(`[orchestrator] Retrying in ${RETRY_DELAY_MS / 1000}s...`)
              await delay(RETRY_DELAY_MS)
            } else {
              addLog(`[orchestrator] All ${MAX_RETRIES} push/PR attempts failed. Work is saved on branch ${agentProcess.branchName}.`)
            }
          }
        }
        cleanupWorktree()
      }).catch((err) => {
        addLog(`[orchestrator] Post-completion error: ${err}`)
        cleanupWorktree()
      })
    } else {
      agentProcess.status = "failed"
      const reason = `Process exited with code ${code}`
      addLog(`[orchestrator] Agent failed: ${reason}`)
      broadcast({ type: "agent.failed", cardId: agentProcess.cardId, projectId: agentProcess.projectId, error: reason })
      notifyFailure(reason)

      Effect.runPromise(
        Effect.gen(function* () {
          yield* kanban.updateAgentStatus(agentProcess.cardId, "failed", reason)
          yield* db.logAudit("agent", agentProcess.cardId, "agent.failed", {
            cardId: agentProcess.cardId,
            agent: agentProcess.agent,
            exitCode: code,
            reason,
          })
        })
      ).catch(console.error)
      cleanupWorktree()
    }
  })

  child.on("error", (err) => {
    clearTimeout(timeoutTimer)
    agentProcess.status = "failed"
    addLog(`[orchestrator] Spawn error: ${err.message}`)
    broadcast({ type: "agent.failed", cardId: agentProcess.cardId, projectId: agentProcess.projectId, error: err.message })
    notifyFailure(`Spawn error: ${err.message}`)

    Effect.runPromise(
      Effect.gen(function* () {
        yield* kanban.updateAgentStatus(agentProcess.cardId, "failed", err.message)
        yield* db.logAudit("agent", agentProcess.cardId, "agent.failed", {
          cardId: agentProcess.cardId,
          agent: agentProcess.agent,
          reason: err.message,
        })
      })
    ).catch(console.error)
    cleanupWorktree()
  })

  return child
}
