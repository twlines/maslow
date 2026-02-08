/**
 * Git Worktree Helpers
 *
 * Creates and removes isolated git worktrees so agents don't clobber
 * the server's working tree.
 */

import { execSync } from "child_process"

export const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)

export function generateBranchName(agent: string, title: string, cardId: string): string {
  return `agent/${agent}/${slugify(title)}-${cardId.slice(0, 8)}`
}

export function worktreePath(cwd: string, cardId: string): string {
  return `${cwd}/.worktrees/${cardId.slice(0, 8)}`
}

/**
 * Create an isolated git worktree on a new branch.
 * Falls back to attaching to an existing branch if the branch already exists.
 */
export function createWorktree(cwd: string, worktreeDir: string, branchName: string): void {
  try {
    execSync(`git worktree add -b ${branchName} ${worktreeDir}`, { cwd, stdio: "pipe" })
  } catch {
    // Branch might already exist — try attaching worktree to existing branch
    execSync(`git worktree add ${worktreeDir} ${branchName}`, { cwd, stdio: "pipe" })
  }
}

/**
 * Remove a worktree (best-effort — may already be gone).
 */
export function removeWorktree(cwd: string, worktreeDir: string): void {
  try {
    execSync(`git worktree remove ${worktreeDir} --force`, { cwd, stdio: "pipe" })
  } catch {
    // Best effort — worktree may already be gone
  }
}
