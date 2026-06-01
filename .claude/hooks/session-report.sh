#!/usr/bin/env bash
# Stop hook: generate session metrics on session end
# Matcher: (none — Stop event)
# Outputs:
#   1. JSON metrics → ~/.claude/metrics/{project-slug}/{date}.json (always)
#   2. SESSION_REPORT.md → project root (opt-in: FORGE_SESSION_REPORT=true)
#
# Reads stdin payload from Stop event (v2.1.145+ adds background_tasks +
# session_crons fields). Back-compat: missing fields default to 0.

# --- Read Stop hook stdin payload (best-effort) ---
PENDING_BG_TASKS=0
ACTIVE_CRONS=0
if [[ ! -t 0 ]] && command -v jq >/dev/null 2>&1; then
  STDIN_PAYLOAD=$(cat 2>/dev/null || true)
  if [[ -n "$STDIN_PAYLOAD" ]]; then
    PENDING_BG_TASKS=$(printf '%s' "$STDIN_PAYLOAD" | jq -r '.background_tasks // [] | length' 2>/dev/null)
    ACTIVE_CRONS=$(printf '%s' "$STDIN_PAYLOAD" | jq -r '.session_crons // [] | length' 2>/dev/null)
    PENDING_BG_TASKS=${PENDING_BG_TASKS//[!0-9]/}; PENDING_BG_TASKS=${PENDING_BG_TASKS:-0}
    ACTIVE_CRONS=${ACTIVE_CRONS//[!0-9]/}; ACTIVE_CRONS=${ACTIVE_CRONS:-0}
  fi
fi

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M)

# --- Project identification ---
PROJECT_NAME=$(basename "$PWD")
PROJECT_SLUG=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g')

# Portable hash: md5sum (Linux) || md5 (macOS) || cksum (POSIX fallback)
_hash() {
  printf '%s' "$1" | md5sum 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | md5 -q 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | cksum | cut -d' ' -f1
}

PROJECT_HASH=$(_hash "$PWD")

# --- Collect raw data ---

# Git changes from this session (last 2 hours of commits)
RECENT_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -50)
FILES_TOUCHED=$(printf '%s\n' "$RECENT_FILES" | grep -c . 2>/dev/null); FILES_TOUCHED=${FILES_TOUCHED//[!0-9]/}; FILES_TOUCHED=${FILES_TOUCHED:-0}
COMMITS=$(git log --oneline --since="2 hours ago" 2>/dev/null | wc -l | tr -d ' ')

# Errors added today
ERRORS_ADDED=0
if [[ -f "CLAUDE_ERRORS.md" ]]; then
  ERRORS_ADDED=$(grep -c "| $DATE |" CLAUDE_ERRORS.md 2>/dev/null); ERRORS_ADDED=${ERRORS_ADDED//[!0-9]/}; ERRORS_ADDED=${ERRORS_ADDED:-0}
fi

# Hook block counters (written by block-destructive.sh and lint-on-save.sh)
DESTRUCTIVE_COUNTER="/tmp/claude-destructive-blocks-${PROJECT_HASH}"
LINT_COUNTER="/tmp/claude-lint-blocks-${PROJECT_HASH}"

HOOK_BLOCKS=0
LINT_BLOCKS=0
if [[ -f "$DESTRUCTIVE_COUNTER" ]]; then
  HOOK_BLOCKS=$(wc -l < "$DESTRUCTIVE_COUNTER" | tr -d ' ')
  rm -f "$DESTRUCTIVE_COUNTER"
fi
if [[ -f "$LINT_COUNTER" ]]; then
  LINT_BLOCKS=$(wc -l < "$LINT_COUNTER" | tr -d ' ')
  rm -f "$LINT_COUNTER"
fi

# Tool-latency counter (written by tool-latency.sh — Claude Code v2.1.119+)
LATENCY_COUNTER="/tmp/claude-tool-latency-${PROJECT_HASH}"
TOOL_CALLS=0
TOOL_TIME_MS=0
TOOL_SLOWEST="none"
if [[ -f "$LATENCY_COUNTER" ]]; then
  TOOL_CALLS=$(wc -l < "$LATENCY_COUNTER" | tr -d ' '); TOOL_CALLS=${TOOL_CALLS//[!0-9]/}; TOOL_CALLS=${TOOL_CALLS:-0}
  if (( TOOL_CALLS > 0 )); then
    TOOL_TIME_MS=$(awk -F'|' 'BEGIN{s=0} {if($2 ~ /^[0-9]+$/) s+=$2} END{print s+0}' "$LATENCY_COUNTER")
    TOOL_SLOWEST=$(awk -F'|' '$2 ~ /^[0-9]+$/ {if ($2+0 > max) {max=$2+0; tool=$1}} END{if (tool!="") printf "%s=%dms", tool, max; else print "none"}' "$LATENCY_COUNTER")
  fi
  rm -f "$LATENCY_COUNTER"
fi

# --- Rule coverage ---
# Cross-reference files touched against globs in .claude/rules/*.md
RULES_DIR=".claude/rules"
RULES_MATCHED=0
TOTAL_RULES=0

if [[ -d "$RULES_DIR" ]] && [[ -n "$RECENT_FILES" ]]; then
  for rule_file in "$RULES_DIR"/*.md; do
    [[ -f "$rule_file" ]] || continue
    # Extract globs from frontmatter
    GLOBS=$(sed -n '/^---$/,/^---$/p' "$rule_file" | grep '^globs:' | sed 's/^globs: *//')
    [[ -z "$GLOBS" ]] && continue
    TOTAL_RULES=$((TOTAL_RULES + 1))

    # Check if any touched file matches any glob pattern
    MATCHED=false
    # Handle both single glob and array format [glob1, glob2]
    CLEAN_GLOBS=$(echo "$GLOBS" | tr -d '[]"' | tr ',' '\n' | sed 's/^ *//;s/ *$//')
    while IFS= read -r glob_pattern; do
      [[ -z "$glob_pattern" ]] && continue
      while IFS= read -r touched_file; do
        [[ -z "$touched_file" ]] && continue
        # Use bash pattern matching (convert glob to regex-like check)
        # Simple approach: use find with the pattern against touched files
        if [[ "$touched_file" == $glob_pattern ]]; then
          MATCHED=true
          break
        fi
      done <<< "$RECENT_FILES"
      $MATCHED && break
    done <<< "$CLEAN_GLOBS"

    $MATCHED && RULES_MATCHED=$((RULES_MATCHED + 1))
  done
fi

# Rule coverage ratio
RULE_COVERAGE="0.00"
if [[ $TOTAL_RULES -gt 0 ]]; then
  RULE_COVERAGE=$(awk "BEGIN {printf \"%.2f\", $RULES_MATCHED / $TOTAL_RULES}")
fi

# --- Domain knowledge tracking ---
DOMAIN_CHANGES=0
if [[ -d ".claude/rules/domain" ]]; then
  DOMAIN_CHANGES=$(printf '%s\n' "$RECENT_FILES" | grep -c '.claude/rules/domain/' 2>/dev/null); DOMAIN_CHANGES=${DOMAIN_CHANGES//[!0-9]/}; DOMAIN_CHANGES=${DOMAIN_CHANGES:-0}
fi

# --- Write JSON metrics ---
METRICS_DIR="$HOME/.claude/metrics/$PROJECT_SLUG"
mkdir -p "$METRICS_DIR"

METRICS_FILE="$METRICS_DIR/${DATE}.json"

# If file exists AND is valid JSON, merge by incrementing.
# If prior file is malformed (known pre-3.3.1 corruption), restart cleanly.
_jq_num() {
  # Read numeric field from METRICS_FILE via jq; fall back to 0 on any error
  # or non-numeric result. Prevents arithmetic cascade failure from corrupted files.
  local val
  val=$(jq -r "$1 // 0" "$METRICS_FILE" 2>/dev/null)
  [[ "$val" =~ ^[0-9]+$ ]] || val=0
  printf '%s' "$val"
}

if [[ -f "$METRICS_FILE" ]] && command -v jq &>/dev/null && jq -e . "$METRICS_FILE" >/dev/null 2>&1; then
  PREV_ERRORS=$(_jq_num '.errors_added')
  PREV_HOOK=$(_jq_num '.hook_blocks')
  PREV_LINT=$(_jq_num '.lint_blocks')
  PREV_FILES=$(_jq_num '.files_touched')
  PREV_COMMITS=$(_jq_num '.commits')
  PREV_SESSIONS=$(_jq_num '.sessions')
  PREV_TOOL_CALLS=$(_jq_num '.tool_calls')
  PREV_TOOL_TIME=$(_jq_num '.tool_time_ms')

  ERRORS_ADDED=$((ERRORS_ADDED + PREV_ERRORS))
  HOOK_BLOCKS=$((HOOK_BLOCKS + PREV_HOOK))
  LINT_BLOCKS=$((LINT_BLOCKS + PREV_LINT))
  FILES_TOUCHED=$((FILES_TOUCHED + PREV_FILES))
  COMMITS=$((COMMITS + PREV_COMMITS))
  SESSIONS=$((PREV_SESSIONS + 1))
  TOOL_CALLS=$((TOOL_CALLS + PREV_TOOL_CALLS))
  TOOL_TIME_MS=$((TOOL_TIME_MS + PREV_TOOL_TIME))
else
  SESSIONS=1
fi

cat > "$METRICS_FILE" << JSON
{
  "project": "$PROJECT_SLUG",
  "date": "$DATE",
  "sessions": $SESSIONS,
  "errors_added": $ERRORS_ADDED,
  "hook_blocks": $HOOK_BLOCKS,
  "lint_blocks": $LINT_BLOCKS,
  "files_touched": $FILES_TOUCHED,
  "rules_matched": $RULES_MATCHED,
  "rules_total": $TOTAL_RULES,
  "rule_coverage": $RULE_COVERAGE,
  "commits": $COMMITS,
  "domain_knowledge_updated": $DOMAIN_CHANGES,
  "tool_calls": $TOOL_CALLS,
  "tool_time_ms": $TOOL_TIME_MS,
  "tool_slowest": "$TOOL_SLOWEST",
  "pending_bg_tasks": $PENDING_BG_TASKS,
  "active_crons": $ACTIVE_CRONS
}
JSON

# --- Error tracking reminder ---
# If files were touched but no errors were logged today, remind the user
if [[ $FILES_TOUCHED -gt 5 && $ERRORS_ADDED -eq 0 ]]; then
  if [[ -f "CLAUDE_ERRORS.md" ]]; then
    echo "💡 Reminder: $FILES_TOUCHED files touched today but 0 errors logged in CLAUDE_ERRORS.md."
    echo "   If you encountered any bugs or gotchas, run: /forge capture \"<description>\""
  fi
fi

# --- Optional: SESSION_REPORT.md (human-readable) ---
if [[ "${FORGE_SESSION_REPORT:-false}" == "true" ]]; then
  RECENT_COMMITS=$(git log --oneline --since="2 hours ago" 2>/dev/null | head -10)

  TESTS_RAN="unknown"
  if git log --oneline --since="2 hours ago" 2>/dev/null | grep -qiE 'test|spec'; then
    TESTS_RAN="yes (referenced in commits)"
  fi

  cat >> "SESSION_REPORT.md" << REPORT

---

## Session: $DATE $TIME

### Metrics
- Files touched: $FILES_TOUCHED
- Commits: $COMMITS
- Hook blocks: $HOOK_BLOCKS (destructive) / $LINT_BLOCKS (lint)
- Rule coverage: $RULES_MATCHED/$TOTAL_RULES ($RULE_COVERAGE)
- Errors logged: $ERRORS_ADDED
- Tool calls: $TOOL_CALLS (total ${TOOL_TIME_MS}ms; slowest: $TOOL_SLOWEST)

### Files
$(echo "$RECENT_FILES" | sed 's/^/- /' 2>/dev/null)

### Commits
$(echo "$RECENT_COMMITS" | sed 's/^/- /' 2>/dev/null)

### Tests
$TESTS_RAN
REPORT
fi

exit 0
