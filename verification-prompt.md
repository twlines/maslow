# P1.1: Delete scratch files

## Goals
Remove dead-weight scratch/prototype files (planning/, research/, debug-bot.ts) totaling ~1,531 lines. Prevent future accumulation by gitignoring the scratch directories.

## Acceptance Criteria
- [ ] `planning/` directory and all contents deleted
- [ ] `research/` directory and all contents deleted
- [ ] `debug-bot.ts` deleted
- [ ] `planning/` added to `.gitignore`
- [ ] `research/` added to `.gitignore`
- [ ] Dead npm scripts (`research`, `planning`) removed from `package.json`
- [ ] No new type-check or lint errors introduced
- [ ] ESLint and tsconfig still safely ignore/exclude these dirs if recreated

## Verification Steps
1. Confirm files are gone: `ls planning/ research/ debug-bot.ts` should all fail
2. Confirm gitignore: `grep -E '^planning/|^research/' .gitignore` shows both entries
3. Confirm no dead scripts: `grep -E '"research"|"planning"' package.json` returns nothing
4. Confirm no regressions: `npm run type-check` and `npm run lint` produce no new errors
5. Confirm safety nets remain: `grep -E 'research|planning' tsconfig.json eslint.config.js` shows exclude/ignore entries still present

## Files Changed
- `.gitignore` — added `planning/` and `research/` entries
- `package.json` — removed `research` and `planning` npm scripts
- `planning/telegram-claude.ts` — deleted (528 lines)
- `planning/unit-integration-tests.ts` — deleted (411 lines)
- `research/telegram-claude.ts` — deleted (296 lines)
- `research/unit-integration-tests.ts` — deleted (263 lines)
- `debug-bot.ts` — deleted (33 lines)
