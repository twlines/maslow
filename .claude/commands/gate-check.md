---
description: Run the full verification gate — type-check, lint, test, build — and report pass/fail
---

# Gate Check

Run the complete CI verification pipeline locally and report results.

## Run All Four Gates

Execute these commands and capture output:

```bash
# Gate 1: Type checking (strictest — catches type errors)
npm run type-check 2>&1

# Gate 2: Linting (catches style and correctness issues)
npm run lint 2>&1

# Gate 3: Tests (catches behavior regressions)
npm test -- --run 2>&1

# Gate 4: Build (catches compilation and module issues)
npm run build 2>&1
```

Run all four even if one fails — report the full picture.

## Analyze Results

For each gate, report:
- PASS or FAIL
- If FAIL: the specific error(s), file(s), and line(s)
- Known pre-existing failures to exclude (e.g., SoulLoader test failures are known)

## Report Format

```
## Gate Check Results

| Gate | Status | Details |
|------|--------|---------|
| type-check | PASS | 0 errors |
| lint | PASS | 0 warnings |
| test | PASS | 69/76 passed (7 known SoulLoader failures) |
| build | PASS | Clean compile |

### Overall: PASS — ready to push
```

Or if failures:

```
### Overall: FAIL — 2 gates blocked

#### type-check failures:
- `src/services/Foo.ts:42` — Type 'string' is not assignable to type 'number'

#### lint failures:
- `src/services/Bar.ts:15` — '@maslow/shared' import should use `.js` extension

### Suggested fixes:
1. ...
2. ...
```

## After Reporting

If all gates pass, inform the user the branch is ready to push.
If any gate fails, offer to fix the issues automatically.
