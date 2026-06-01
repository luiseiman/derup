---
globs: "**/*"
description: "Suggest capturing practices when generalizable patterns are detected"
---

## Practice Capture
After completing a task, check if any of these signals are present:
- A workaround was needed because the obvious approach failed
- A bug required more than one fix attempt to resolve
- An architectural or config decision involved real trade-offs
- A tool, flag, or API behavior was non-obvious or surprising
- A rule in CLAUDE.md or a stack rule was missing and would have prevented the problem

If ANY signal is present, suggest at the end of your response:
```
💡 This looks generalizable. Run `/cap "<one-line summary>"` to capture it.
```
Do NOT suggest for: trivial tasks, routine edits, tasks where the first approach worked cleanly.
Threshold: if you had to reason about it or backtrack, suggest it. If not, stay silent.
