/**
 * Skill Loader Service
 *
 * Discovers, parses, and caches skills from the skills/ directory.
 * Skills are prompt-layer extensions — pure markdown that teaches agents
 * how to do things. No executable code.
 *
 * Skills are selected per-task based on keyword matching and injected
 * into the agent's system prompt within a token budget.
 */

import { Context, Effect, Layer } from "effect"
import { ConfigService } from "./Config.js"
import * as fs from "fs"
import * as pathModule from "path"
import type { Skill, SkillScope, SkillDomain } from "@maslow/shared"

export interface SkillLoaderService {
  /** Load all skills applicable to a given scope */
  loadForScope(scope: "ollama" | "claude"): Effect.Effect<Skill[], never>

  /** Select the best skills for a task, within a token budget */
  selectForTask(
    task: { title: string; description: string },
    scope: "ollama" | "claude",
    budgetTokens: number
  ): Effect.Effect<Skill[], never>

  /** Build a prompt injection block from selected skills */
  buildPromptBlock(skills: Skill[]): Effect.Effect<string, never>

  /** Reload skills from disk (for hot-reload) */
  reload(): Effect.Effect<void, never>
}

export class SkillLoader extends Context.Tag("SkillLoader")<
  SkillLoader,
  SkillLoaderService
>() {}

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Simple parser — no dependency on a YAML library.
 */
const parseFrontmatter = (content: string): {
  meta: Record<string, string | string[]>
  body: string
} => {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
  if (!fmMatch) return { meta: {}, body: content }

  const meta: Record<string, string | string[]> = {}
  let currentKey = ""

  for (const line of fmMatch[1].split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/)
    if (kvMatch) {
      currentKey = kvMatch[1]
      const value = kvMatch[2].trim()
      if (value) {
        meta[currentKey] = value
      } else {
        meta[currentKey] = []
      }
    } else if (line.match(/^\s+-\s+/) && currentKey && Array.isArray(meta[currentKey])) {
      const item = line.replace(/^\s+-\s+/, "").trim()
      if (item) (meta[currentKey] as string[]).push(item)
    }
  }

  return { meta, body: fmMatch[2] }
}

/**
 * Rough token estimate: ~4 chars per token for English text.
 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/**
 * Extract keywords from text for skill matching.
 * Reuses the same logic as OllamaAgent's extractKeywords.
 */
const extractKeywords = (text: string): string[] => {
  const keywords: string[] = []

  const pathMatches = text.match(/(?:src|packages|apps)\/[\w/.-]+\.ts/g)
  if (pathMatches) keywords.push(...pathMatches)

  const pascalMatches = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g)
  if (pascalMatches) keywords.push(...pascalMatches)

  const camelMatches = text.match(/\b[a-z][a-zA-Z]{4,}\b/g)
  if (camelMatches) {
    const common = new Set(["should", "would", "could", "before", "after", "these", "those", "which", "where", "there", "their", "about", "being", "other", "using", "return", "ensure", "update", "change", "implement"])
    keywords.push(...camelMatches.filter(w => !common.has(w)))
  }

  // Also extract plain words > 4 chars for domain matching
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  keywords.push(...words.slice(0, 20))

  return [...new Set(keywords)]
}

export const SkillLoaderLive = Layer.effect(
  SkillLoader,
  Effect.gen(function* () {
    const config = yield* ConfigService
    let skillCache: Skill[] = []

    const loadSkillsFromDir = (dir: string): Skill[] => {
      if (!fs.existsSync(dir)) return []

      const skills: Skill[] = []
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = pathModule.join(dir, entry.name, "SKILL.md")
        if (!fs.existsSync(skillPath)) continue

        const raw = fs.readFileSync(skillPath, "utf-8")
        const { meta, body } = parseFrontmatter(raw)

        const skill: Skill = {
          name: (meta.name as string) || entry.name,
          description: (meta.description as string) || "",
          scope: ((meta.scope as string) || "both") as SkillScope,
          domain: ((meta.domain as string) || "code") as SkillDomain,
          requires: Array.isArray(meta.requires) ? meta.requires : [],
          contextBudget: parseInt((meta["context-budget"] as string) || "0", 10) || estimateTokens(body),
          content: body.trim(),
          filePath: skillPath,
        }

        skills.push(skill)
      }

      return skills
    }

    const loadAll = (): Skill[] => {
      const workspaceSkills = loadSkillsFromDir(
        pathModule.join(config.workspace.path, "skills")
      )
      return workspaceSkills
    }

    // Initial load
    skillCache = loadAll()

    return {
      loadForScope: (scope) =>
        Effect.sync(() =>
          skillCache.filter(s => s.scope === scope || s.scope === "both")
        ),

      selectForTask: (task, scope, budgetTokens) =>
        Effect.sync(() => {
          const candidates = skillCache.filter(
            s => s.scope === scope || s.scope === "both"
          )

          if (candidates.length === 0) return []

          const keywords = extractKeywords(`${task.title}\n${task.description}`)

          const scored = candidates.map(skill => {
            let score = 0
            const skillText = `${skill.name} ${skill.description} ${skill.domain}`.toLowerCase()

            for (const kw of keywords) {
              if (skillText.includes(kw.toLowerCase())) score++
              if (skill.content.toLowerCase().includes(kw.toLowerCase())) score += 0.5
            }

            return { skill, score }
          })

          scored.sort((a, b) => b.score - a.score)

          let remaining = budgetTokens
          const selected: Skill[] = []

          for (const { skill, score } of scored) {
            if (score <= 0) continue
            const cost = skill.contextBudget
            if (cost <= remaining) {
              selected.push(skill)
              remaining -= cost
            }
          }

          return selected
        }),

      buildPromptBlock: (skills) =>
        Effect.sync(() => {
          if (skills.length === 0) return ""

          const blocks = skills.map(s =>
            `### ${s.name}\n${s.content}`
          )

          return `\n## Applicable Skills\n\n${blocks.join("\n\n---\n\n")}`
        }),

      reload: () =>
        Effect.sync(() => {
          skillCache = loadAll()
        }),
    }
  })
)
