---
name: conversation-context
description: How to use prior decisions and daily logs before starting work
scope: ollama
domain: thinking
context-budget: 200
---

# Conversation Context

Before writing any code, check for prior context that may affect your approach.

## Check Daily Logs
Read `memory/YYYY-MM-DD.md` (today's date) for:
- What other agents have done today — avoid duplicating work
- Security blocks — paths or patterns that were rejected
- Recently verified branches — avoid conflicts with in-flight work

## Check Decisions Table
The card may reference decisions made in conversation. Look for:
- `linked_decision_ids` on the kanban card
- Decision records contain: title, description, alternatives considered, reasoning, tradeoffs
- Honor the decision — do not re-decide what was already resolved

## Check Card Context
The `context_snapshot` field on a kanban card may contain:
- Specific files to modify
- Approach notes from the human or thinking partner
- Constraints or requirements not in the title

## Priority Order
When instructions conflict:
1. HEARTBEAT.md checkboxes (human override — highest priority)
2. Card context snapshot (human-curated instructions)
3. Linked decisions (conversational context)
4. Skill guidance (general patterns)
5. Your own judgment (last resort)
