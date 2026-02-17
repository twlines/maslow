/**
 * Verification Protocol
 *
 * Pure functions for running quality gates on agent worktrees and
 * computing codebase health metrics. Used by AgentOrchestrator (Gate 1)
 * and Heartbeat (Gate 2).
 */

import { execSync } from "child_process"
import type { CodebaseMetrics } from "@maslow/shared"

export interface VerificationCheckResult {
  passed: boolean
  tscOutput: string
  lintOutput: string
  testOutput: string
  tscTimedOut: boolean
  lintTimedOut: boolean
  testTimedOut: boolean
}

type CmdResult = { ok: boolean; output: string; timedOut: boolean }

const runCmd = (cmd: string, cwd: string, timeoutMs = 120_000): CmdResult => {
  try {
    const output = execSync(cmd, {
      cwd,
      stdio: "pipe",
      timeout: timeoutMs,
      env: { ...process.env, FORCE_COLOR: "0" },
    }).toString().trim()
    return { ok: true, output, timedOut: false }
  } catch (err: unknown) {
    const execErr = err as { stdout?: Buffer; stderr?: Buffer; killed?: boolean; signal?: string }
    const timedOut = execErr.killed === true || execErr.signal === "SIGTERM"
    const output = [
      execErr.stdout?.toString() ?? "",
      execErr.stderr?.toString() ?? "",
    ].join("\n").trim()
    return {
      ok: false,
      output: timedOut ? `TIMEOUT after ${timeoutMs}ms\n${output}` : output,
      timedOut,
    }
  }
}

/**
 * Run tsc + eslint + vitest on a worktree directory.
 * Returns pass/fail with captured output for each check.
 */
export const runVerification = (cwd: string): VerificationCheckResult => {
  const tsc = runCmd("npx tsc --noEmit", cwd)
  const lint = runCmd("npx eslint src/ --no-warn-ignored", cwd)
  const test = runCmd("npx vitest run --reporter=verbose 2>&1", cwd)

  return {
    passed: tsc.ok && lint.ok && test.ok,
    tscOutput: tsc.output,
    lintOutput: lint.output,
    testOutput: test.output,
    tscTimedOut: tsc.timedOut,
    lintTimedOut: lint.timedOut,
    testTimedOut: test.timedOut,
  }
}

/**
 * Compute codebase health metrics from a working directory.
 * Uses eslint JSON output for lint counts, grep for `any` count,
 * and find for file counts.
 */
export const computeCodebaseMetrics = (cwd: string): CodebaseMetrics => {
  // Lint warnings/errors via eslint JSON format
  let lintWarnings = 0
  let lintErrors = 0
  const lintResult = runCmd("npx eslint src/ --format json --no-warn-ignored 2>/dev/null", cwd, 60_000)
  try {
    const lintResults = JSON.parse(lintResult.output) as Array<{ warningCount: number; errorCount: number }>
    for (const file of lintResults) {
      lintWarnings += file.warningCount
      lintErrors += file.errorCount
    }
  } catch { /* parse failure — count as 0 */ }

  // Count `any` type usage (`: any`, `as any`)
  const anyResult = runCmd("grep -rn ': any\\|as any' src/ --include='*.ts' 2>/dev/null | wc -l", cwd, 30_000)
  const anyCount = parseInt(anyResult.output.trim()) || 0

  // Count test files
  const testResult = runCmd("find src/ -name '*.test.ts' 2>/dev/null | wc -l", cwd, 10_000)
  const testFileCount = parseInt(testResult.output.trim()) || 0

  // Count total TypeScript files
  const totalResult = runCmd("find src/ -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null | wc -l", cwd, 10_000)
  const totalFiles = parseInt(totalResult.output.trim()) || 0

  return {
    lintWarnings,
    lintErrors,
    anyCount,
    testFileCount,
    totalFiles,
    timestamp: Date.now(),
  }
}
