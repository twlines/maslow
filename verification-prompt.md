# Verification: Add pre-commit hook enforcing CLI spawn rules

## Card Title
Add pre-commit hook enforcing CLI spawn rules

## Goals
Create a pre-commit git hook that enforces Claude CLI spawn conventions across all TypeScript files, preventing commits that introduce non-compliant spawn patterns.

## Acceptance Criteria

- [x] `.git/hooks/pre-commit` exists and is executable (`chmod +x`)
- [x] Hook gets staged `.ts` files via `git diff --cached --name-only --diff-filter=d`
- [x] Hook greps staged files for `spawn.*claude` patterns
- [x] For matching files, hook checks for presence of:
  - `--verbose` flag
  - `stream-json` output format
  - `bypassPermissions` permission mode
  - `stdin.*end` (stdin close call)
  - `delete.*ANTHROPIC_API_KEY` (key stripping)
- [x] Hook fails with descriptive error listing which rule is missing and which file
- [x] Hook passes cleanly when no `.ts` files are staged
- [x] Hook passes cleanly when staged `.ts` files don't contain Claude spawn patterns
- [x] Version-controlled copy in `scripts/hooks/pre-commit`
- [x] Bash syntax validates (`bash -n`)

## Verification Steps

1. **Syntax check**: `bash -n .git/hooks/pre-commit` should report no errors
2. **Permissions check**: `ls -la .git/hooks/pre-commit` should show `-rwxr-xr-x`
3. **Positive test (should catch violations)**: Stage `src/services/ClaudeSession.ts` and run `git stash && git add src/services/ClaudeSession.ts && .git/hooks/pre-commit` — should fail listing missing rules
4. **Negative test (should pass)**: Create a test `.ts` file without Claude spawn patterns, stage it, and run the hook — should pass
5. **Pattern matching**: The hook uses `grep -qE 'spawn.*claude|spawn\(.*"claude"'` to detect Claude CLI spawn sites

## Files Changed

- `.git/hooks/pre-commit` — the active pre-commit hook (replaces previous ClaudeSession-only version)
- `scripts/hooks/pre-commit` — version-controlled copy of the hook
- `verification-prompt.md` — this file
