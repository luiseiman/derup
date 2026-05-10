#!/usr/bin/env bash
# PostToolUse hook: capture per-tool duration_ms (v2.1.119+) for session-report.
# Matcher: "" (all tools).
# Output: appends "tool_name|duration_ms" lines to /tmp/claude-tool-latency-<hash>.
# Silent (exit 0) — telemetry only, never blocks.
#
# Back-compat: if duration_ms is absent or non-numeric (older Claude Code),
# this hook is a no-op. session-report.sh handles a missing counter file.

# --- Project hash (must match session-report.sh) ---
_hash() {
  printf '%s' "$1" | md5sum 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | md5 -q 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | cksum | cut -d' ' -f1
}
PROJECT_HASH=$(_hash "$PWD")
COUNTER="/tmp/claude-tool-latency-${PROJECT_HASH}"

# --- Read stdin JSON (PostToolUse payload) ---
PAYLOAD=$(cat)
[[ -z "$PAYLOAD" ]] && exit 0

# --- Parse fields (jq required; degrade silently if absent) ---
command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME=$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)
DURATION=$(printf '%s' "$PAYLOAD" | jq -r '.duration_ms // empty' 2>/dev/null)

# Sanitize: tool_name without pipes; duration must be a non-negative integer
[[ -z "$TOOL_NAME" || -z "$DURATION" ]] && exit 0
TOOL_NAME=${TOOL_NAME//|/_}
DURATION=${DURATION//[!0-9]/}
[[ -z "$DURATION" ]] && exit 0

printf '%s|%s\n' "$TOOL_NAME" "$DURATION" >> "$COUNTER" 2>/dev/null || true
exit 0
