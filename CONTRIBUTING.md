# Contributing to Maslow

## Pull Request Rules

1. **All changes via PR** — no direct pushes to `main`.
2. **CI must pass** — lint, type-check, test, and build must all succeed.
3. **1 human review required** — every PR needs at least one approving review from a human.
4. **Squash merge only** — keeps `main` history linear and readable.

## Agent-Generated PRs

Agent PRs follow the exact same rules as human PRs:

- No auto-merge — a human must review and approve.
- Keep PRs small — prefer under 400 changed lines.
- One logical change per PR — don't bundle unrelated work.
- Descriptive commit messages — explain *what* and *why*, not just *how*.

## PR Size Guidelines

- **Preferred**: under 400 lines changed.
- **Acceptable**: 400–800 lines if the change is a single cohesive unit.
- **Requires justification**: over 800 lines — split if possible.

## Code Standards

- **No `any`** — use `unknown` and narrow, or define proper types.
- **Effect-TS patterns** — follow the `Context.Tag` + `Layer.effect` service pattern.
- **No semicolons** — follow existing codebase style.
- **Double quotes** for strings.
- **2-space indentation**.
- **Explicit return types** on service methods.
- **No barrel exports** — import from specific files.

## Running CI Locally

```bash
npm install
npm run lint
npm run type-check
npm test -- --run
npm run build
```

All four must pass before opening a PR.
