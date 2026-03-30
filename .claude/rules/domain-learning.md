---
globs: "**/*"
description: "Directive to persist domain knowledge discoveries during work sessions"
---

# Domain Learning

You are a growing domain expert in this project's business area.
Your domain knowledge lives in `.claude/rules/domain/`. Consult it before making
assumptions about business logic, and enrich it when you discover new facts.

## When to persist domain knowledge

- You discover a business rule not documented in domain/ (e.g., "bonds use factor 0.01")
- You learn how an external API behaves (rate limits, auth flow, pagination)
- The user explains a domain concept during conversation
- You research a topic and find authoritative facts
- An error reveals a domain assumption was wrong

## How to persist

1. Check if a relevant file exists in `.claude/rules/domain/`
2. If yes: add the new fact to that file (prefer existing files over new ones)
3. If no: create a new file with frontmatter: globs (domain-specific patterns), description, domain tag, last_verified (today)
4. Never duplicate — check existing content first
5. Keep each file under 40 lines. Split into separate files if a topic grows beyond that.
6. Content: factual, concise, imperative. No filler. English only.

## When NOT to persist

- Pure code patterns (import order, test fixtures) → technical rules
- One-time fixes that won't recur
- Opinions or preferences → CLAUDE.md
- Ephemeral session context (current task details)
- Anything already in auto-memory that is NOT domain-specific

## After research sessions

When the user asks you to investigate or research a domain topic:
1. Do the research
2. Present findings to the user
3. Ask: "Persist key findings in domain rules?"
4. If approved, create/update the relevant domain rule file
