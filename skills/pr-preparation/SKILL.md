---
name: pr-preparation
description: Commit and PR preparation standards for agent output
scope: ollama
domain: ops
context-budget: 200
---

# PR Preparation

## Commit Message
- Format: `agent(ollama): {card title}`
- One logical change per commit
- No unrelated changes bundled together

## Change Scope
- Keep under 400 changed lines per card
- Touch only files needed for the task
- Do not refactor surrounding code
- Do not add docstrings or comments to unchanged code

## Before Committing
- Remove all debug `console.log` statements
- Remove unused imports you added
- Ensure no `any` types introduced
- Verify `.js` extensions on all new imports
- Run `git diff` mentally — every changed line should relate to the card

## Do NOT
- Modify test files unless the card specifically asks for tests
- Change configuration files (tsconfig, eslint, package.json)
- Add new dependencies
- Rename existing functions or variables beyond what the card requires
