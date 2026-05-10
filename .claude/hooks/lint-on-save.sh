#!/usr/bin/env bash
# PostToolUse hook: auto-lint on file save
# Install: .claude/hooks/lint-on-save.sh
# Matcher: Write|Edit
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]] || [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# Portable hash: md5sum (Linux) || md5 (macOS) || cksum (POSIX fallback)
_hash() {
  printf '%s' "$1" | md5sum 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | md5 -q 2>/dev/null | cut -c1-8 || \
  printf '%s' "$1" | cksum | cut -d' ' -f1
}

# Counter file for session metrics (read by session-report.sh)
LINT_COUNTER="/tmp/claude-lint-blocks-$(_hash "$PWD")"

# Helper: log lint block and exit
_lint_block() {
  echo "$1" >&2
  echo "$(date +%Y-%m-%dT%H:%M:%S) $FILE_PATH" >> "$LINT_COUNTER"
  exit 2
}

# Python → ruff
if [[ "$FILE_PATH" =~ \.py$ ]]; then
  if command -v ruff &>/dev/null; then
    OUTPUT=$(ruff check "$FILE_PATH" 2>&1)
    if [[ $? -ne 0 ]]; then
      _lint_block "$OUTPUT"
    fi
  fi
fi

# TypeScript/JavaScript → eslint
if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  if command -v npx &>/dev/null && [[ -f "node_modules/.bin/eslint" ]]; then
    OUTPUT=$(npx eslint "$FILE_PATH" --no-error-on-unmatched-pattern 2>&1)
    if [[ $? -ne 0 ]]; then
      _lint_block "$OUTPUT"
    fi
  fi
fi

# TypeScript → tsc type-check (opt-in, set FORGE_TSC_CHECK=true to enable)
# Disabled by default: runs full project type-check on every save, slow on large projects
if [[ "${FORGE_TSC_CHECK:-false}" == "true" ]] && [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]] && command -v npx &>/dev/null; then
  TSCONFIG=""
  DIR=$(dirname "$FILE_PATH")
  while [[ "$DIR" != "/" ]]; do
    if [[ -f "$DIR/tsconfig.json" ]]; then
      TSCONFIG="$DIR/tsconfig.json"
      break
    fi
    DIR=$(dirname "$DIR")
  done

  if [[ -n "$TSCONFIG" ]]; then
    OUTPUT=$(npx tsc --noEmit --project "$TSCONFIG" 2>&1)
    if [[ $? -ne 0 ]]; then
      _lint_block "$OUTPUT"
    fi
  fi
fi

# Swift → swiftlint
if [[ "$FILE_PATH" =~ \.swift$ ]]; then
  if command -v swiftlint &>/dev/null; then
    OUTPUT=$(swiftlint lint --path "$FILE_PATH" 2>&1)
    if [[ $? -ne 0 ]]; then
      _lint_block "$OUTPUT"
    fi
  fi
fi

# Shell → shellcheck
if [[ "$FILE_PATH" =~ \.sh$ ]]; then
  if command -v shellcheck &>/dev/null; then
    OUTPUT=$(shellcheck "$FILE_PATH" 2>&1)
    if [[ $? -ne 0 ]]; then
      _lint_block "$OUTPUT"
    fi
  fi
fi

exit 0
