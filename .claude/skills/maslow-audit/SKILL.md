---
name: maslow-audit
description: Run architecture, security, and code quality audits on the Maslow codebase. Use when reviewing changes before commit, checking for security issues, validating boundary rules, or assessing build readiness. Invoke with /maslow-audit [scope] where scope is one of full, security, architecture, deps, or encryption.
---

# Maslow Codebase Audit

Systematically audit the Maslow codebase for architecture violations, security issues, dependency problems, and code quality concerns. Run this before commits, after major changes, or when assessing build readiness.

## Audit Scopes

| Scope | What it checks |
|-------|---------------|
| `full` (default) | All checks below |
| `security` | Secrets exposure, input validation, encryption usage, env var handling |
| `architecture` | Boundary rules, layer composition, circular deps, service patterns |
| `deps` | Unused imports, missing dependencies, version conflicts |
| `encryption` | E2E encryption wiring — is crypto actually used, or just imported? |

## Workflow

1. **Determine scope** from user input (default: `full`)
2. **Run checks** for that scope using the procedures below
3. **Report findings** as a structured table with severity levels
4. **Suggest fixes** for any issues found

## Check Procedures

### Security Audit

1. **Secrets in code** — Search for hardcoded tokens, API keys, passwords:
   - Grep for patterns: `password`, `secret`, `token`, `apikey`, `api_key`, `ANTHROPIC`, `Bearer`
   - Exclude: `.env.example`, `node_modules/`, test files, this skill file
   - Verify `.env` is in `.gitignore`
   - Check git history is clean: `git log --all --oneline -S "ANTHROPIC_API_KEY" -- ':!.env.example'`

2. **Input validation** — Check all HTTP/WS handlers validate input before processing:
   - Read `src/services/AppServer.ts`
   - Verify REST endpoints validate request body fields
   - Verify WebSocket message handlers check `type` and required fields
   - Flag any `JSON.parse()` without try/catch

3. **Env var stripping** — Verify ANTHROPIC_API_KEY is stripped from child process env:
   - Read ClaudeSession.ts spawn configuration
   - Confirm `ANTHROPIC_API_KEY` is explicitly deleted from env

4. **Auth** — Check bearer token auth is enforced:
   - Read AppServer.ts auth middleware
   - Verify all routes (except health check) require auth

5. **File permissions** — Check `.env` file permissions:
   - Run `ls -la .env` and verify it's `600` (owner read/write only)

### Architecture Audit

1. **Boundary rules** — Verify import paths follow rules:
   - `apps/*` files must NOT import from `src/`
   - `packages/*` files must NOT import from `src/` or `apps/`
   - `src/` files must NOT import from `apps/`
   - Grep for violations: `from ["'].*\.\./\.\./src/` in apps/, `from ["'].*\.\./\.\./apps/` in src/

2. **Service pattern compliance** — Each service in `src/services/` should have:
   - An exported interface (`<Name>Service`)
   - A `Context.Tag` class
   - A `Layer.effect` or `Layer.scoped` implementation
   - Read each service file and verify

3. **Layer composition** — Read `src/index.ts`:
   - Verify all services are composed
   - Verify composition order matches dependency graph
   - Flag any service that's defined but not composed

4. **Circular dependencies** — Check for import cycles:
   - Build a dependency map from import statements
   - Flag any cycles

### Dependency Audit

1. **TypeScript strict mode** — Verify `strict: true` in all tsconfig files
2. **No `any`** — Grep for `: any` and `as any` (excluding node_modules)
3. **Unused imports** — Run `npx tsc --noEmit` and check for unused import warnings
4. **Lint clean** — Run `npx eslint .` and report error count

### Encryption Audit

1. **Crypto module status** — Read `packages/shared/src/crypto/`:
   - Is the module complete? (key generation, encrypt, decrypt)
   - Is it exported from the package?
2. **Usage check** — Grep for crypto imports across the codebase:
   - Is `encrypt()` called before storing messages?
   - Is `decrypt()` called when reading messages?
   - Are keys generated and stored securely?
3. **Gap analysis** — If crypto exists but isn't wired:
   - Identify exactly where encryption should be added
   - List the files and functions that need modification

## Report Format

```
## Maslow Audit Report — <scope>

### Summary
- Checks passed: X/Y
- Issues found: Z (N critical, M warning, K info)

### Findings

| # | Severity | Category | Finding | Location | Fix |
|---|----------|----------|---------|----------|-----|
| 1 | CRITICAL | Security | Hardcoded token found | file:line | Remove and use env var |
| 2 | WARNING  | Architecture | Boundary violation | file:line | Change import path |
| 3 | INFO     | Deps | Unused import | file:line | Remove import |

### Recommendations
1. ...
2. ...
```

## Severity Levels

| Level | Meaning |
|-------|---------|
| CRITICAL | Security vulnerability, data exposure risk, or broken functionality |
| WARNING | Architecture violation, code smell, or potential future issue |
| INFO | Style issue, minor improvement, or observation |
