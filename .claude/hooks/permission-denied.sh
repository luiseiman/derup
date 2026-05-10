#!/usr/bin/env bash
# Permission Denied hook - logs denied operations for audit trail
# Event: PermissionDenied
# Reads: $TOOL_INPUT (JSON with tool_name, arguments, reason)
# Output: .claude/session/permission-denials.log

set -e

LOG_DIR=".claude/session"
LOG_FILE="$LOG_DIR/permission-denials.log"

# Create log directory if needed
mkdir -p "$LOG_DIR"

# Parse input (tool_name, arguments, reason from environment or stdin)
TOOL_INPUT="${TOOL_INPUT:-}"
if [ -z "$TOOL_INPUT" ]; then
  TOOL_INPUT="$(cat)"
fi

# Extract fields from JSON (portable awk-based parsing)
TOOL_NAME=$(printf '%s' "$TOOL_INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
ARGUMENTS=$(printf '%s' "$TOOL_INPUT" | grep -o '"arguments":"[^"]*"' | cut -d'"' -f4 || echo "")
REASON=$(printf '%s' "$TOOL_INPUT" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "")

# Truncate arguments to 100 chars
ARGUMENTS_TRUNC="${ARGUMENTS:0:100}"
[ "${#ARGUMENTS}" -gt 100 ] && ARGUMENTS_TRUNC="${ARGUMENTS_TRUNC}..."

# ISO timestamp
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Log entry: ISO timestamp | tool | args (truncated) | reason
printf '%s | %s | %s | %s\n' "$TIMESTAMP" "$TOOL_NAME" "$ARGUMENTS_TRUNC" "$REASON" >> "$LOG_FILE"

exit 0
