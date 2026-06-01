---
globs: ".claude/session/*"
description: "Update context checkpoint after significant tasks"
---

## Context Continuity

- After completing a significant task (>3 files changed, architectural decision, complex bug fix), update `.claude/session/last-compact.md` with active restrictions and decisions that must not be lost
- Format: `## Active Constraints\n- [what must not change and why]`
- This file is automatically re-injected after compaction via session-restore.sh
