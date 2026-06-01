---
globs: "**/*"
---

# Model Routing Rules

Select the appropriate Claude model for each task and subagent.

## haiku — speed over depth

- Searching files, grepping, listing, reading for orientation
- Running commands and reporting results (test runs, lint, build)
- Repetitive transformations: rename, reformat, migrate syntax
- Short factual questions with deterministic answers
- Fetching and summarizing external content (docs, URLs)

Default agents: `researcher`, `test-runner`

## sonnet — standard implementation

- Implementing a feature with a clear, well-scoped spec
- Fixing a bug where the root cause is already identified
- Code review of focused PRs (< 500 lines, single concern)
- Debugging with sufficient context already available
- Writing or updating documentation

Default agents: `implementer`, `code-reviewer`, `session-reviewer`

## opus — depth where it matters

- Designing architecture across 3+ components with real trade-offs
- Security audits where missing a vulnerability has production consequences
- Tasks where the right approach is genuinely unclear
- Refactoring that touches core abstractions shared across the codebase
- Reviewing high-risk operations: migrations, auth changes, payment flows

Default agents: `architect`, `security-auditor`

## Escalation

Start sonnet. Escalate to opus if: 2+ valid approaches with real consequences, security/data integrity, or 2 failed sonnet attempts. Downgrade to haiku for pure retrieval.

## MCP operations

Read/list → haiku. Write with known intent → sonnet. Migrations/schema/production → opus.
