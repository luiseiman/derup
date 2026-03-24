#!/bin/bash
# PreToolUse hook: block dangerous bash commands
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)

DANGEROUS_PATTERNS=(
  'rm -rf /'
  'rm -rf \*'
  'rm -rf ~'
  'DROP TABLE'
  'DROP DATABASE'
  'git push.*--force.*main'
  'git push.*--force.*master'
  'git reset --hard'
  'chmod -R 777'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: destructive command detected" >&2
    echo "Pattern: $pattern" >&2
    echo "Command: $COMMAND" >&2
    exit 2
  fi
done

exit 0
