---
description: Triage backlog cards — score by dependency order and complexity, propose next batch
---

# Backlog Triage

You are triaging the kanban backlog to decide what to work on next.

## Step 1: Pull All Backlog Cards

Query the database for all cards in the `backlog` column:

```bash
sqlite3 data/app.db "SELECT id, title, description, labels, priority, estimated_complexity FROM kanban_cards WHERE \"column\" = 'backlog' ORDER BY priority DESC, position ASC"
```

## Step 2: Categorize Each Card

For each card, determine:

**Agent type:**
- `ollama` — Mechanical, well-scoped, single-file or pattern-following tasks. The Ollama agent (qwen2.5-coder:7b) can handle these autonomously.
- `interactive` — Requires architectural decisions, multi-system coordination, or judgment calls. Needs a human+Claude session.
- `blocked` — Depends on another card being done first, or needs external input.

**Complexity (1-5):**
- 1: Single function change, under 20 lines
- 2: Single file change, under 100 lines
- 3: Multi-file change, under 300 lines
- 4: Multi-service change, new entity pipeline
- 5: Architectural change, new subsystem

**Dependencies:**
- Which other cards must be completed before this one?
- Use card titles to identify logical ordering

## Step 3: Score and Rank

Score = `priority * 2 + (6 - complexity) + dependency_bonus`

Where `dependency_bonus` = +3 if the card unblocks 2+ other cards, +1 if it unblocks 1.

## Step 4: Present Results

Output a table like:

```
## Triage Results

### Recommended Next 5 (Ollama-ready)
| # | Card | Complexity | Score | Unblocks |
|---|------|-----------|-------|----------|
| 1 | Add return types to service methods | 2 | 12 | 0 |
| 2 | ... | ... | ... | ... |

### Recommended Next 3 (Interactive Session)
| # | Card | Complexity | Why Interactive |
|---|------|-----------|----------------|
| 1 | Refactor AppServer routing | 4 | Architectural decision needed |

### Blocked Cards (need resolution)
| Card | Blocked By |
|------|-----------|
| ... | ... |

### Summary
- Total backlog: X cards
- Ollama-ready: Y
- Interactive: Z
- Blocked: W
```

## Step 5: Offer Actions

Ask if the user wants to:
1. Tag the Ollama-ready cards with `agent:ollama` label
2. Start the top-ranked card immediately
3. Adjust priorities based on the analysis
