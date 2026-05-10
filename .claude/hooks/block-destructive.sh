#!/usr/bin/env bash
# PreToolUse hook: block dangerous bash commands
# Install: .claude/hooks/block-destructive.sh
# Matcher: Bash
# Supports FORGE_HOOK_PROFILE: minimal | standard (default) | strict
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)

PROFILE="${FORGE_HOOK_PROFILE:-standard}"

# Portable hash: md5sum (Linux) || md5 (macOS) || cksum (POSIX fallback)
_hash() {
  printf '%s' "$1" | md5sum 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | md5 -q 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | cksum | cut -d' ' -f1
}

# Minimal: only the most catastrophic patterns
MINIMAL_PATTERNS=(
  'rm -rf /'
  'rm -rf \.?\*'
  'rm -rf ~'
  'git push.*--force.*main'
  'git push.*--force.*master'
)

# Standard: current behavior (minimal + broader destructive ops)
STANDARD_PATTERNS=(
  'DROP TABLE'
  'DROP DATABASE'
  'TRUNCATE TABLE'
  'DELETE FROM .* WHERE 1'
  'git reset --hard'
  'docker system prune -a'
  'chmod -R 777'
)

# Strict: standard + risky execution patterns
STRICT_PATTERNS=(
  'curl.*\|.*sh'
  'wget.*\|.*sh'
  'eval '
  'chmod 777'
  'chmod -R 777'
  '> /etc/'
  'tee /etc/'
  'dd if=.* of=/dev/'
)

# Build active pattern list based on profile
DANGEROUS_PATTERNS=("${MINIMAL_PATTERNS[@]}")

if [[ "$PROFILE" == "standard" || "$PROFILE" == "strict" ]]; then
  DANGEROUS_PATTERNS+=("${STANDARD_PATTERNS[@]}")
fi

if [[ "$PROFILE" == "strict" ]]; then
  DANGEROUS_PATTERNS+=("${STRICT_PATTERNS[@]}")
fi

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: destructive command detected [$PROFILE profile]" >&2
    echo "Pattern: $pattern" >&2
    echo "Command: $COMMAND" >&2
    # Increment block counter for session metrics
    COUNTER_FILE="/tmp/claude-destructive-blocks-$(_hash "$PWD")"
    echo "$(date +%Y-%m-%dT%H:%M:%S) $pattern" >> "$COUNTER_FILE"
    exit 2
  fi
done

exit 0
