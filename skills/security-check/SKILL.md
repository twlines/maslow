---
name: security-check
description: Security checklist for code changes
scope: both
domain: code
context-budget: 200
---

# Security Checklist

## Input Validation
- Validate all user/external input before processing
- Never interpolate user input into SQL — use prepared statements
- Never interpolate user input into shell commands
- Sanitize file paths — resolve and check they stay within expected directories

## Secrets
- No hardcoded API keys, tokens, or passwords
- All secrets via environment variables (Config service)
- Never log secrets or include in error messages
- ANTHROPIC_API_KEY must be stripped from child process env

## Dependencies
- No new dependencies without justification
- Check `better-sqlite3` uses prepared statements (stmts pattern)
- Wrap `execSync` calls with explicit `cwd` and `timeout`

## Data
- JSON columns: validate structure on read, not just parse
- Foreign keys enabled (`PRAGMA foreign_keys = ON`)
- No raw SQL string concatenation
