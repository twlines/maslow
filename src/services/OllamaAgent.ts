/**
 * Ollama Agent Service
 *
 * Executes kanban card tasks using a local Ollama LLM. Implements a 5-phase
 * agent loop: context gathering → prompt assembly → Ollama API call →
 * response parsing/application → verification with retry.
 *
 * Replaces Claude CLI for autonomous kanban work. Claude is reserved for
 * interactive thinking partner conversations.
 */

import { Context, Effect, Layer } from "effect"
import { ConfigService } from "./Config.js"
import { execSync } from "child_process"
import * as fs from "fs"
import * as pathModule from "path"
import { OLLAMA_TASK_PROTOCOL } from "./protocols/AgentProtocols.js"
import { runVerification } from "./protocols/VerificationProtocol.js"
import { agentLog } from "./AgentLog.js"

export interface OllamaTaskResult {
  success: boolean
  filesModified: string[]
  retryCount: number
  totalInputTokens: number
  totalOutputTokens: number
}

interface EditBlock {
  path: string
  action: "replace" | "create"
  content: string
}

interface OllamaResponse {
  message: { role: string; content: string }
  eval_count?: number
  prompt_eval_count?: number
}

export interface OllamaAgentService {
  executeTask(options: {
    worktreeDir: string
    card: { id: string; title: string; description: string }
    projectId: string
    onLog: (line: string) => void
  }): Effect.Effect<OllamaTaskResult, Error>
}

export class OllamaAgent extends Context.Tag("OllamaAgent")<
  OllamaAgent,
  OllamaAgentService
>() {}

const MAX_FILE_CHARS = 20_000
const MAX_SINGLE_FILE_CHARS = 8_000
const EDIT_PATTERN = /<edit\s+path="([^"]+)"\s+action="(replace|create)">([\s\S]*?)<\/edit>/g

/**
 * Extract keywords from card title/description to find relevant files.
 * Looks for file paths, module names, function names, and identifiers.
 */
const extractKeywords = (text: string): string[] => {
  const keywords: string[] = []

  // Explicit file paths (src/services/Foo.ts, etc.)
  const pathMatches = text.match(/(?:src|packages|apps)\/[\w/.-]+\.ts/g)
  if (pathMatches) keywords.push(...pathMatches)

  // PascalCase identifiers (service names, class names)
  const pascalMatches = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g)
  if (pascalMatches) keywords.push(...pascalMatches)

  // camelCase identifiers (function names)
  const camelMatches = text.match(/\b[a-z][a-zA-Z]{4,}\b/g)
  if (camelMatches) {
    // Filter common words
    const common = new Set(["should", "would", "could", "before", "after", "these", "those", "which", "where", "there", "their", "about", "being", "other", "using", "return", "ensure", "update", "change", "implement"])
    keywords.push(...camelMatches.filter(w => !common.has(w)))
  }

  return [...new Set(keywords)]
}

/**
 * Find and read relevant files from the worktree based on card content.
 */
const gatherContext = (
  worktreeDir: string,
  card: { title: string; description: string },
  onLog: (line: string) => void
): { files: Array<{ path: string; content: string }>; totalChars: number } => {
  const files: Array<{ path: string; content: string }> = []
  let totalChars = 0

  const keywords = extractKeywords(`${card.title}\n${card.description}`)
  onLog(`[ollama] Keywords extracted: ${keywords.join(", ")}`)

  const addedPaths = new Set<string>()

  const addFile = (relPath: string): boolean => {
    if (addedPaths.has(relPath)) return false
    const absPath = pathModule.join(worktreeDir, relPath)
    if (!fs.existsSync(absPath)) return false
    const stat = fs.statSync(absPath)
    if (!stat.isFile()) return false

    let content = fs.readFileSync(absPath, "utf-8")
    if (content.length > MAX_SINGLE_FILE_CHARS) {
      content = content.slice(0, MAX_SINGLE_FILE_CHARS) + "\n// ... truncated ..."
    }

    if (totalChars + content.length > MAX_FILE_CHARS) {
      onLog(`[ollama] Context budget exhausted at ${totalChars} chars — skipping ${relPath}`)
      return false
    }

    files.push({ path: relPath, content })
    addedPaths.add(relPath)
    totalChars += content.length
    return true
  }

  // 1. Try explicit file paths from card description
  for (const kw of keywords) {
    if (kw.includes("/") && kw.endsWith(".ts")) {
      addFile(kw)
    }
  }

  // 2. Search for PascalCase identifiers (likely service/class names)
  const pascalKeywords = keywords.filter(kw => /^[A-Z]/.test(kw))
  for (const kw of pascalKeywords) {
    if (totalChars >= MAX_FILE_CHARS) break
    try {
      const result = execSync(
        `grep -rl "${kw}" src/ --include="*.ts" 2>/dev/null | head -5`,
        { cwd: worktreeDir, stdio: "pipe", timeout: 10_000 }
      ).toString().trim()
      for (const filePath of result.split("\n").filter(Boolean)) {
        if (totalChars >= MAX_FILE_CHARS) break
        addFile(filePath)
      }
    } catch { /* grep found nothing */ }
  }

  // 3. If we still have no files, try the camelCase keywords
  if (files.length === 0) {
    const camelKeywords = keywords.filter(kw => /^[a-z]/.test(kw)).slice(0, 5)
    for (const kw of camelKeywords) {
      if (totalChars >= MAX_FILE_CHARS) break
      try {
        const result = execSync(
          `grep -rl "${kw}" src/ --include="*.ts" 2>/dev/null | head -3`,
          { cwd: worktreeDir, stdio: "pipe", timeout: 10_000 }
        ).toString().trim()
        for (const filePath of result.split("\n").filter(Boolean)) {
          if (totalChars >= MAX_FILE_CHARS) break
          addFile(filePath)
        }
      } catch { /* grep found nothing */ }
    }
  }

  onLog(`[ollama] Gathered ${files.length} file(s), ${totalChars} chars total`)
  return { files, totalChars }
}

/**
 * Build the system prompt for Ollama — coding standards + output format.
 */
const buildSystemPrompt = (): string => {
  return `You are a code agent that modifies TypeScript files to complete tasks.

## Output Format
You MUST respond with ONLY <edit> blocks. No explanations, no markdown fences, no commentary.

Each <edit> block contains the ENTIRE new file content:
<edit path="src/services/Foo.ts" action="replace">
// entire file content here
</edit>

Use action="replace" for existing files, action="create" for new files.

## Coding Standards
- No semicolons
- Double quotes for strings
- 2-space indentation
- Explicit return types on service methods
- Effect-TS patterns: Context.Tag + Layer.effect
- No \`any\` — use \`unknown\` and narrow
- Wrap better-sqlite3 calls in Effect.sync(), not Effect.tryPromise()

${OLLAMA_TASK_PROTOCOL}`
}

/**
 * Build the user prompt with file contents and task.
 */
const buildUserPrompt = (
  files: Array<{ path: string; content: string }>,
  card: { title: string; description: string }
): string => {
  const fileBlocks = files
    .map(f => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n")

  return `## Current Files\n${fileBlocks}\n\n## Task\n**${card.title}**\n\n${card.description}`
}

/**
 * Build a retry prompt with error feedback.
 */
const buildRetryPrompt = (
  files: Array<{ path: string; content: string }>,
  errors: { tscOutput: string; lintOutput: string; testOutput: string },
  retryNum: number
): string => {
  const errorSections: string[] = []
  if (errors.tscOutput) errorSections.push(`### TypeScript Errors\n\`\`\`\n${errors.tscOutput.slice(0, 2000)}\n\`\`\``)
  if (errors.lintOutput) errorSections.push(`### Lint Errors\n\`\`\`\n${errors.lintOutput.slice(0, 1000)}\n\`\`\``)
  if (errors.testOutput) errorSections.push(`### Test Failures\n\`\`\`\n${errors.testOutput.slice(0, 1000)}\n\`\`\``)

  const fileBlocks = files
    .map(f => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n")

  const urgency = retryNum >= 3
    ? "This is your FINAL attempt. Fix ONLY the errors listed above. Do not restructure."
    : "Fix the errors below. Output ONLY <edit> blocks for the files that need changes."

  return `${urgency}\n\n${errorSections.join("\n\n")}\n\n## Current Files (after your previous edits)\n${fileBlocks}`
}

/**
 * Parse Ollama response for <edit> blocks.
 */
const parseEdits = (response: string): EditBlock[] => {
  const edits: EditBlock[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(EDIT_PATTERN.source, "g")
  while ((match = pattern.exec(response)) !== null) {
    edits.push({
      path: match[1],
      action: match[2] as "replace" | "create",
      content: match[3].trim(),
    })
  }
  return edits
}

/**
 * Validate that an edit path resolves inside the worktree.
 * Prevents path traversal attacks (e.g., ../../.env, /etc/passwd).
 */
const isPathSafe = (worktreeDir: string, editPath: string): boolean => {
  const resolved = pathModule.resolve(worktreeDir, editPath)
  return resolved.startsWith(pathModule.resolve(worktreeDir) + pathModule.sep)
}

/**
 * Apply edit blocks to the worktree filesystem.
 * Rejects any path that escapes the worktree boundary.
 */
const applyEdits = (worktreeDir: string, edits: EditBlock[], onLog: (line: string) => void): string[] => {
  const modified: string[] = []
  for (const edit of edits) {
    if (!isPathSafe(worktreeDir, edit.path)) {
      onLog(`[ollama] BLOCKED: path traversal attempt — "${edit.path}" escapes worktree`)
      agentLog.securityBlock(worktreeDir, edit.path, edit.path)
      continue
    }
    const absPath = pathModule.join(worktreeDir, edit.path)
    if (edit.action === "create") {
      const dir = pathModule.dirname(absPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
    fs.writeFileSync(absPath, edit.content + "\n", "utf-8")
    modified.push(edit.path)
    onLog(`[ollama] ${edit.action}: ${edit.path}`)
  }
  return modified
}

export const OllamaAgentLive = Layer.effect(
  OllamaAgent,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const { host, model, maxRetries } = config.ollama

    return {
      executeTask: (options) =>
        Effect.gen(function* () {
          const { worktreeDir, card, onLog } = options
          let totalInputTokens = 0
          let totalOutputTokens = 0
          let allModified: string[] = []

          onLog(`[ollama] Starting task: "${card.title}" with model ${model}`)

          // Phase 1: Health check
          const healthCheck = yield* Effect.tryPromise({
            try: () => fetch(`${host}/api/tags`).then(r => r.ok),
            catch: () => new Error(`Ollama not reachable at ${host}`),
          })
          if (!healthCheck) {
            return yield* Effect.fail(new Error(`Ollama not reachable at ${host}`))
          }

          // Phase 2: Context gathering
          const { files, totalChars } = gatherContext(worktreeDir, card, onLog)
          if (files.length === 0) {
            onLog("[ollama] No relevant files found — card may be too vague")
            return yield* Effect.fail(new Error("No relevant files found for this card"))
          }

          if (totalChars > MAX_FILE_CHARS) {
            onLog(`[ollama] Context too large (${totalChars} chars) — card too complex for local agent`)
            return yield* Effect.fail(new Error("Card too complex for local agent — needs interactive session"))
          }

          // Phase 3-5: Prompt → Call → Parse → Apply → Verify (with retry loop)
          const systemPrompt = buildSystemPrompt()
          const messages: Array<{ role: string; content: string }> = [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserPrompt(files, card) },
          ]

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            onLog(`[ollama] Attempt ${attempt + 1}/${maxRetries + 1} — calling ${model}...`)

            // Call Ollama
            const response = yield* Effect.tryPromise({
              try: async () => {
                const res = await fetch(`${host}/api/chat`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model,
                    messages,
                    stream: false,
                    options: {
                      temperature: 0.1,
                      num_ctx: 8192,
                    },
                  }),
                })
                if (!res.ok) {
                  throw new Error(`Ollama API returned ${res.status}: ${await res.text()}`)
                }
                return await res.json() as OllamaResponse
              },
              catch: (err) => new Error(`Ollama API call failed: ${err}`),
            })

            const assistantContent = response.message.content
            totalInputTokens += response.prompt_eval_count ?? 0
            totalOutputTokens += response.eval_count ?? 0

            onLog(`[ollama] Response: ${assistantContent.length} chars, ${response.eval_count ?? 0} output tokens`)

            // Parse edit blocks
            const edits = parseEdits(assistantContent)
            if (edits.length === 0) {
              onLog("[ollama] No <edit> blocks found in response")
              // Add to conversation for retry
              messages.push({ role: "assistant", content: assistantContent })
              messages.push({
                role: "user",
                content: "You MUST respond with <edit> blocks. No explanations. Re-read the task and output ONLY <edit path=\"...\" action=\"replace\">...file content...</edit> blocks.",
              })
              continue
            }

            // Apply edits
            const modified = applyEdits(worktreeDir, edits, onLog)
            allModified = [...new Set([...allModified, ...modified])]

            // Commit changes in worktree
            try {
              execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" })
              execSync(
                `git commit -m "agent(ollama): ${card.title.replace(/"/g, '\\"')}"`,
                { cwd: worktreeDir, stdio: "pipe" }
              )
              onLog("[ollama] Changes committed")
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              if (errMsg.includes("nothing to commit")) {
                onLog("[ollama] No changes to commit (edits may be identical to original)")
              } else {
                onLog(`[ollama] Git commit failed: ${errMsg}`)
              }
            }

            // Run verification
            onLog("[ollama] Running verification (tsc + eslint + vitest)...")
            const verification = runVerification(worktreeDir)

            if (verification.passed) {
              onLog("[ollama] Verification PASSED")
              return {
                success: true,
                filesModified: allModified,
                retryCount: attempt,
                totalInputTokens,
                totalOutputTokens,
              }
            }

            onLog(`[ollama] Verification FAILED (attempt ${attempt + 1}/${maxRetries + 1})`)

            if (attempt < maxRetries) {
              // Re-read modified files for retry context
              const updatedFiles = allModified.map(p => {
                const absPath = pathModule.join(worktreeDir, p)
                if (!fs.existsSync(absPath)) return null
                let content = fs.readFileSync(absPath, "utf-8")
                if (content.length > MAX_SINGLE_FILE_CHARS) {
                  content = content.slice(0, MAX_SINGLE_FILE_CHARS) + "\n// ... truncated ..."
                }
                return { path: p, content }
              }).filter((f): f is { path: string; content: string } => f !== null)

              messages.push({ role: "assistant", content: assistantContent })
              messages.push({
                role: "user",
                content: buildRetryPrompt(updatedFiles, verification, attempt + 1),
              })
            }
          }

          // All retries exhausted
          onLog(`[ollama] All ${maxRetries + 1} attempts failed — marking card as blocked`)
          return {
            success: false,
            filesModified: allModified,
            retryCount: maxRetries,
            totalInputTokens,
            totalOutputTokens,
          }
        }),
    }
  })
)
