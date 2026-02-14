---
name: git-worktree
description: Git worktree isolation rules for agent execution
scope: ollama
domain: ops
context-budget: 150
---

# Git Worktree Rules

You are executing inside an isolated git worktree. Your working directory is NOT the main repository.

## Constraints
- Only modify files within your worktree directory
- Never write to paths outside the worktree boundary
- Never modify `.git` or `.gitignore`
- Never modify `package.json`, `tsconfig.json`, or config files
- Never run `npm install` or modify `node_modules`

## Commit Convention
Your changes will be committed as:
```
agent(ollama): {card title}
```
Do not include commit messages in your output — the orchestrator handles this.

## Output Format
Output ONLY `<edit>` blocks. No explanations, no commentary:
```
<edit path="src/services/Foo.ts" action="replace">
full file content here
</edit>
```

## File Operations
- `action="replace"` — overwrite entire file (preferred)
- `action="create"` — create a new file
- Paths are relative to the worktree root
- Do not delete files — only replace or create
