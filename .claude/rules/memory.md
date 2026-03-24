---
globs: "**/*"
description: "Memory management policy — always loaded"
---

# Memory Policy

## Error Memory (CLAUDE_ERRORS.md)
- Before modifying code, read CLAUDE_ERRORS.md for known issues in the affected area
- After fixing a bug, record it: date, area, root cause, fix applied, derived rule
- If same error appears 3+ times across sessions, promote the derived rule to _common.md or a stack-specific rule
- Format: markdown table with columns Date | Area | Error | Cause | Fix | Rule

## Agent Memory (.claude/agent-memory/)
- Agents with `memory: project` persist learnings in .claude/agent-memory/<agent-name>/
- Consult agent memory before starting work in their domain
- Update agent memory after completing tasks with new discoveries
- Agents WITHOUT memory (researcher, test-runner) are transactional — they execute and report, don't accumulate knowledge

## Auto-Memory (Claude Code built-in)
- Claude Code persists discoveries automatically when autoMemoryEnabled is true
- Do not duplicate auto-memory content in CLAUDE.md — they serve different purposes
- CLAUDE.md = prescriptive (what to do). Auto-memory = descriptive (what was discovered)
