/**
 * Gate 0 — Pre-Execution Validation
 *
 * Validates that a card is ready for autonomous agent work BEFORE
 * spawning an agent. Catches bad input early to avoid wasting compute
 * on cards that will inevitably fail.
 *
 * Checks:
 * 1. Card has non-empty title
 * 2. Card has description or context_snapshot (agent needs instructions)
 * 3. No other agent is already working on this card
 * 4. Worktree can be created (git state is clean enough)
 * 5. Required skills exist for this card type (SkillLoader returns > 0)
 */

import { execSync } from "child_process"
import * as fs from "fs"

export interface Gate0Result {
  passed: boolean
  failures: string[]
}

export interface Gate0Options {
  card: {
    id: string
    title: string
    description: string
    contextSnapshot: string | null
    agentStatus: string | null
  }
  cwd: string
  runningCardIds: Set<string>
  skillCount: number
}

export const runGate0 = (options: Gate0Options): Gate0Result => {
  const failures: string[] = []

  // 1. Card has non-empty title
  if (!options.card.title || options.card.title.trim().length === 0) {
    failures.push("Card has no title")
  }

  // 2. Card has description or context snapshot
  const hasDescription = options.card.description && options.card.description.trim().length > 0
  const hasContext = options.card.contextSnapshot && options.card.contextSnapshot.trim().length > 0
  if (!hasDescription && !hasContext) {
    failures.push("Card has no description or context snapshot — agent has no instructions")
  }

  // 3. No other agent already running on this card
  if (options.runningCardIds.has(options.card.id)) {
    failures.push("Another agent is already running on this card")
  }
  if (options.card.agentStatus === "running") {
    failures.push("Card is marked as agent-running")
  }

  // 4. Git state allows worktree creation
  try {
    execSync("git status --porcelain", { cwd: options.cwd, stdio: "pipe", timeout: 10_000 })
  } catch {
    failures.push("Cannot read git status — repository may be in a bad state")
  }

  // Check disk space (basic: ensure data dir is writable)
  const worktreeParent = `${options.cwd}/.worktrees`
  try {
    if (!fs.existsSync(worktreeParent)) {
      fs.mkdirSync(worktreeParent, { recursive: true })
    }
    // Quick write test
    const testFile = `${worktreeParent}/.gate0-test`
    fs.writeFileSync(testFile, "ok")
    fs.unlinkSync(testFile)
  } catch {
    failures.push("Cannot write to .worktrees directory — disk may be full or permissions wrong")
  }

  // 5. Skills available for this card
  if (options.skillCount === 0) {
    failures.push("No skills matched this card — agent will have no domain guidance")
  }

  return {
    passed: failures.length === 0,
    failures,
  }
}
