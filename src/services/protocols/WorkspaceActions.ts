/**
 * Workspace Actions Protocol
 *
 * Pure parsing logic and prompt for Claude workspace action blocks.
 * Actions allow Claude to create kanban cards, log decisions, track
 * assumptions, and update project state from conversation.
 */

export interface WorkspaceAction {
  type: "create_card" | "move_card" | "log_decision" | "add_assumption" | "update_state"
  title?: string
  description?: string
  column?: string
  alternatives?: string[]
  reasoning?: string
  tradeoffs?: string
  assumption?: string
  summary?: string
}

const VALID_ACTION_TYPES: ReadonlySet<WorkspaceAction["type"]> = new Set([
  "create_card",
  "move_card",
  "log_decision",
  "add_assumption",
  "update_state",
])

// Workspace actions system prompt — injected into project-scoped conversations
// so Claude can create cards, log decisions, and track assumptions from conversation
export const WORKSPACE_ACTIONS_PROMPT = `
You have workspace actions available. When appropriate during conversation, emit action blocks to manage the project workspace. Use these naturally — when you notice a task to track, a decision being made, or an assumption being stated.

Available actions (emit as JSON blocks wrapped in :::action and ::: delimiters):

1. Create a kanban card:
:::action
{"type":"create_card","title":"Card title","description":"Optional description","column":"backlog"}
:::

2. Move a card (columns: backlog, in_progress, done):
:::action
{"type":"move_card","title":"Card title to find","column":"done"}
:::

3. Log a decision:
:::action
{"type":"log_decision","title":"Decision title","description":"What was decided","alternatives":["Option A","Option B"],"reasoning":"Why this path","tradeoffs":"What we give up"}
:::

4. Track an assumption:
:::action
{"type":"add_assumption","assumption":"What we're assuming but haven't validated"}
:::

5. Update project state summary:
:::action
{"type":"update_state","summary":"Current state: what's done, in progress, blocked, next"}
:::

Rules:
- Only emit actions when they naturally arise from conversation
- Don't announce actions — just do them. The user sees the result in their workspace
- Multiple actions per response are fine
- For move_card, match by title substring (case-insensitive)
- Prefer backlog for new ideas, in_progress for active work, done for completed items
`.trim()

/**
 * Parse :::action {json} ::: blocks from Claude text output.
 * Pure function — no side effects. Skips malformed or invalid blocks.
 */
export function parseWorkspaceActions(text: string): WorkspaceAction[] {
  const actions: WorkspaceAction[] = []
  const regex = /:::action\s*\n([\s\S]*?)\n:::/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim())
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        typeof (parsed as Record<string, unknown>).type === "string" &&
        VALID_ACTION_TYPES.has((parsed as Record<string, unknown>).type as WorkspaceAction["type"])
      ) {
        actions.push(parsed as WorkspaceAction)
      }
    } catch {
      // Skip malformed JSON blocks
    }
  }
  return actions
}
