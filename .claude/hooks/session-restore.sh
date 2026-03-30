#!/usr/bin/env bash
# SessionStart hook — re-injects last compact checkpoint when session resumes after compaction
# Only fires on source="compact", silent on regular startup

set -euo pipefail

HOOK_INPUT=$(cat)
SOURCE=$(echo "$HOOK_INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('source','startup'))" 2>/dev/null || echo "startup")

CHECKPOINT_FILE=".claude/session/last-compact.md"

# Only re-inject on compaction resume, not on regular startup or clear
if [ "$SOURCE" != "compact" ]; then
  exit 0
fi

if [ ! -f "$CHECKPOINT_FILE" ]; then
  exit 0
fi

# Output to stdout — Claude Code injects this as context at session start
echo "## Restored Context (post-compaction)"
echo ""
cat "$CHECKPOINT_FILE"
echo ""
echo "---"
echo "*Context above was preserved from the previous compaction cycle. Resume work from this state.*"

exit 0
