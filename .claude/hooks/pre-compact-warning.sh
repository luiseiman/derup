#!/usr/bin/env bash
# UserPromptSubmit hook — warn proactively when context approaches 80% of model window.
#
# Implements the evidence-based 80% threshold from dotforge compaction-strategy.md.
# Estimates token count from the transcript file size (~5 bytes per token, rough).
# Non-blocking: prints warning to stderr, exits 0.
#
# Configuration via env vars (settings.json env block):
#   CLAUDE_CONTEXT_LIMIT       — model context size (default 1000000 = 1M Sonnet/Opus)
#   CLAUDE_COMPACT_WARN_PCT    — warning threshold percentage (default 80)
#   CLAUDE_COMPACT_URGENT_PCT  — urgent threshold percentage (default 90)
#
# Limitations:
# - Transcript byte size is a proxy. Real context = transcript + system prompt + memory.
# - Heuristic 5 bytes/token ignores JSON overhead in transcript format.
# - Warning fires at most once per turn (UserPromptSubmit).
#
# To disable: remove from settings.json hooks, or set CLAUDE_COMPACT_WARN_PCT=999

set -uo pipefail

HOOK_INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || echo "")

[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

# Approx: 1 token ≈ 5 bytes (conservative for transcript JSON overhead)
SIZE=$(wc -c < "$TRANSCRIPT_PATH" 2>/dev/null | tr -d ' ' || echo 0)
EST_TOKENS=$((SIZE / 5))

CONTEXT_LIMIT=${CLAUDE_CONTEXT_LIMIT:-1000000}
WARN_PCT=${CLAUDE_COMPACT_WARN_PCT:-80}
URGENT_PCT=${CLAUDE_COMPACT_URGENT_PCT:-90}

WARN_TOKENS=$((CONTEXT_LIMIT * WARN_PCT / 100))
URGENT_TOKENS=$((CONTEXT_LIMIT * URGENT_PCT / 100))
PCT=$((EST_TOKENS * 100 / CONTEXT_LIMIT))

if [ "$EST_TOKENS" -gt "$URGENT_TOKENS" ]; then
    cat >&2 <<EOF

⚠ URGENT — context window est. at ${PCT}% (~${EST_TOKENS} tokens / ${CONTEXT_LIMIT})
   Run NOW:  /forge compact-task
   Auto-compact will fire at 96.7% if you don't.
EOF
elif [ "$EST_TOKENS" -gt "$WARN_TOKENS" ]; then
    cat >&2 <<EOF

⚠ Context window est. at ${PCT}% (~${EST_TOKENS} tokens / ${CONTEXT_LIMIT})
   Recommended: /forge compact-task  (evidence-based 80% threshold)
   Or: /clear  (if switching to unrelated task)
EOF
fi

exit 0
