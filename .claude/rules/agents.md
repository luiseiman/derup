---
globs: "**/*"
description: "Multi-agent orchestration rules — always loaded"
---

# Agent Orchestration Protocol

## Delegation Decision Tree

Before starting any task, evaluate:

1. **Single-file fix / quick question** → handle directly, no subagent
2. **Research-heavy or verbose output** → delegate to `researcher`
3. **Code changes + tests needed** → delegate to `implementer`
4. **Security/vulnerability concern** → delegate to `security-auditor`
5. **Multi-component refactor (>3 files, >2 concerns)** → evaluate Agent Teams
6. **Code review before merge** → delegate to `code-reviewer`
7. **Architecture decision or tradeoff analysis** → delegate to `architect`

## Subagent Invocation Rules

- Use `Agent(subagent_type="<name>", ...)` to spawn new subagents
- To continue a subagent's work, use `SendMessage({to: agentId})` — NEVER spawn a new agent for follow-up
- Pass minimal, focused context — don't dump the full conversation
- Each subagent must return a structured summary, not raw output
- Chain subagents sequentially: researcher → architect → implementer → code-reviewer
- If a subagent result is unclear or incomplete, resume it via SendMessage — don't restart

## Agent Teams Escalation Criteria

Spawn an Agent Team ONLY when ALL of these hold:
- Task touches ≥3 independent components/files
- Components don't share mutable state during the task
- Estimated single-agent time >15 min
- Each teammate can own a distinct file set (no overlap)

Team structure pattern:
- **Lead**: coordinates, synthesizes, DOES NOT implement
- **Teammates**: max 3-4 (diminishing returns beyond that)
- Require plan approval before any teammate writes code

## Context Management

- Subagents preserve main thread context — use them for token-heavy exploration
- After compaction, re-summarize active agent results if still relevant
- Never let a subagent's raw output consume >30% of main context
- Prefer summaries: "what changed, what was found, what to do next"

## Error Handling

- If a subagent fails or produces garbage → log to `tasks/lessons.md`, don't retry blindly
- If Agent Team coordination degrades (merge conflicts, stale messages) → dissolve team, fallback to sequential subagents
- Always verify subagent output (run tests/lint) before declaring done
