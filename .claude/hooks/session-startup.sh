#!/usr/bin/env bash
# SessionStart hook — capture startup snapshot, detect drift, inject brief.
#
# Fires on every SessionStart EXCEPT source=compact (handled by
# session-restore.sh). Captures branch, HEAD, working tree, recent .claude/
# edits, pending TODOs, behaviors-disabled state. Compares against the most
# recent entry in startup-history/ to surface drift since last startup.
#
# Outputs to stdout — Claude Code injects that as initial context. Output
# only emits when there is something noteworthy: dirty tree, recent edits,
# or HEAD differs from last startup.
#
# Persists:
#   .claude/session/last-startup.md           full snapshot
#   .claude/session/startup-history/<ISO>.md  rotating, last 5

set -uo pipefail

HOOK_INPUT=$(cat)
SOURCE=$(echo "$HOOK_INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('source','startup'))" 2>/dev/null || echo "startup")

# session-restore.sh handles compact. Skip here to avoid double-injection.
[ "$SOURCE" = "compact" ] && exit 0

SESSION_DIR=".claude/session"
STARTUP_FILE="$SESSION_DIR/last-startup.md"
HISTORY_DIR="$SESSION_DIR/startup-history"
mkdir -p "$SESSION_DIR" "$HISTORY_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ISO_FILE_TS=$(date -u +"%Y%m%dT%H%M%SZ")
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
GIT_STATUS=$(git status --short 2>/dev/null | head -30)
GIT_STATUS_COUNT=$(git status --short 2>/dev/null | wc -l | tr -d ' ')

# Recent .claude/ edits in last 24h (capped to 20 entries for context economy)
RECENT_CLAUDE=$(find .claude -type f \( -name "*.md" -o -name "*.sh" -o -name "*.json" \) -mtime -1 2>/dev/null | grep -v "/session/\|/agent-memory/" | head -20)
RECENT_COUNT=$(printf '%s\n' "$RECENT_CLAUDE" | grep -c . || true)

# Pending TODO/FIXME markers in tracked guidance files
PENDING_TODOS=$(grep -rn "TODO\|FIXME\|XXX" CLAUDE.md .claude/rules/*.md .claude/agent-memory/*.md 2>/dev/null | grep -v "^Binary" | head -10)
TODO_COUNT=$(printf '%s\n' "$PENDING_TODOS" | grep -c . || true)

# Behaviors disabled in index.yaml (v3 governance)
BEHAVIORS_DISABLED=""
if [ -f behaviors/index.yaml ]; then
    BEHAVIORS_DISABLED=$(python3 -c "
import yaml, sys
try:
    d = yaml.safe_load(open('behaviors/index.yaml'))
    off = [b['id'] for b in d.get('behaviors', []) if not b.get('enabled', True)]
    if off: print(','.join(off))
except Exception: pass
" 2>/dev/null)
fi

# Drift detection: read previous snapshot's HEAD
DRIFT_SECTION=""
DRIFT_BRIEF=""
PREV_STARTUP=$(ls -1t "$HISTORY_DIR"/*.md 2>/dev/null | head -1)
if [ -n "$PREV_STARTUP" ] && [ -f "$PREV_STARTUP" ]; then
    PREV_HEAD=$(grep "^\*\*HEAD:\*\*" "$PREV_STARTUP" | head -1 | sed 's/.*HEAD:\*\* //' | tr -d ' ')
    PREV_TS=$(grep "^\*\*Started:\*\*" "$PREV_STARTUP" | head -1 | sed 's/.*Started:\*\* //' | tr -d ' ')
    if [ -n "$PREV_HEAD" ] && [ "$PREV_HEAD" != "$GIT_HEAD" ] && [ "$PREV_HEAD" != "?" ]; then
        COMMITS_AHEAD=$(git rev-list --count "$PREV_HEAD..$GIT_HEAD" 2>/dev/null || echo "?")
        DRIFT_BRIEF="$COMMITS_AHEAD commits ahead of last startup ($PREV_HEAD @ $PREV_TS)"
        DRIFT_SECTION="**Drift since last startup**: $DRIFT_BRIEF"
    fi
fi

# Persistence
write_snapshot() {
    local target="$1"
    cat > "$target" <<EOF
# Session Startup Snapshot
**Started:** $TIMESTAMP
**Source:** $SOURCE
**Branch:** $GIT_BRANCH
**HEAD:** $GIT_HEAD
**Working tree:** $GIT_STATUS_COUNT changed files
**Recent .claude/ edits (24h):** $RECENT_COUNT files
**Pending TODOs:** $TODO_COUNT
**Behaviors disabled:** ${BEHAVIORS_DISABLED:-none}

$DRIFT_SECTION

## Working Tree
\`\`\`
$GIT_STATUS
\`\`\`

## Recent .claude/ edits (mtime < 24h, top 20)
\`\`\`
$RECENT_CLAUDE
\`\`\`

## Pending TODOs (top 10)
\`\`\`
$PENDING_TODOS
\`\`\`
EOF
}

write_snapshot "$STARTUP_FILE"
write_snapshot "$HISTORY_DIR/${ISO_FILE_TS}.md"

# Rotate: keep last 5
ls -1t "$HISTORY_DIR"/*.md 2>/dev/null | tail -n +6 | xargs -I {} rm -f {} 2>/dev/null || true

# Inject brief into context only if something is noteworthy
SHOULD_BRIEF=0
[ "$GIT_STATUS_COUNT" -gt 0 ] && SHOULD_BRIEF=1
[ "$RECENT_COUNT" -gt 0 ] && SHOULD_BRIEF=1
[ -n "$DRIFT_BRIEF" ] && SHOULD_BRIEF=1
[ -n "$BEHAVIORS_DISABLED" ] && SHOULD_BRIEF=1
[ "$TODO_COUNT" -gt 0 ] && SHOULD_BRIEF=1

if [ "$SHOULD_BRIEF" -eq 1 ]; then
    echo "## Session Startup Brief"
    echo ""
    echo "**Branch:** $GIT_BRANCH @ $GIT_HEAD"
    echo "**Working tree:** $GIT_STATUS_COUNT changed files"
    [ -n "$DRIFT_BRIEF" ] && echo "**Drift:** $DRIFT_BRIEF"
    [ "$RECENT_COUNT" -gt 0 ] && echo "**Recent .claude/ edits (24h):** $RECENT_COUNT"
    [ -n "$BEHAVIORS_DISABLED" ] && echo "**Behaviors disabled:** $BEHAVIORS_DISABLED"
    [ "$TODO_COUNT" -gt 0 ] && echo "**Pending TODOs:** $TODO_COUNT"
    echo ""
    echo "Full snapshot: \`.claude/session/last-startup.md\`. Last 5 in \`.claude/session/startup-history/\`."
fi

exit 0
