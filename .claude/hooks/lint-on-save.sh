#!/bin/bash
# PostToolUse hook: auto-lint on file save
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]] || [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# TypeScript/JavaScript → eslint
if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  if command -v npx &>/dev/null && [[ -f "node_modules/.bin/eslint" ]]; then
    OUTPUT=$(npx eslint "$FILE_PATH" --no-error-on-unmatched-pattern 2>&1)
    if [[ $? -ne 0 ]]; then
      echo "$OUTPUT" >&2
      exit 2
    fi
  fi
fi

exit 0
