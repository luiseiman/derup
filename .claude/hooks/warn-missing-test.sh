#!/usr/bin/env bash
# PostToolUse hook: warn when creating source files without corresponding tests
# Matcher: Write
# Only active when FORGE_HOOK_PROFILE=strict
# Warning only (exit 0) — educational, not enforcement

PROFILE="${FORGE_HOOK_PROFILE:-standard}"
[[ "$PROFILE" != "strict" ]] && exit 0

FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0

# Only check source directories
if ! echo "$FILE_PATH" | grep -qE '(^|/)(src|app|lib)/'; then
  exit 0
fi

# Skip test files themselves
if echo "$FILE_PATH" | grep -qE '(test_|_test\.|\.test\.|\.spec\.|__tests__|tests/)'; then
  exit 0
fi

# Skip non-code files
if ! echo "$FILE_PATH" | grep -qE '\.(py|ts|tsx|js|jsx|go|rs|java|rb|swift)$'; then
  exit 0
fi

# Extract filename without extension and path
BASENAME=$(basename "$FILE_PATH")
NAME_NO_EXT="${BASENAME%.*}"
EXT="${BASENAME##*.}"

# Check for corresponding test file
FOUND_TEST=false
for test_dir in "tests" "__tests__" "test" "spec"; do
  for test_pattern in "test_${NAME_NO_EXT}" "${NAME_NO_EXT}_test" "${NAME_NO_EXT}.test" "${NAME_NO_EXT}.spec"; do
    if find . -path "*/${test_dir}/${test_pattern}.*" -o -path "*/${test_pattern}.${EXT}" 2>/dev/null | grep -q .; then
      FOUND_TEST=true
      break 2
    fi
  done
done

if [[ "$FOUND_TEST" == "false" ]]; then
  echo "WARNING: New source file created without corresponding test" >&2
  echo "File: $FILE_PATH" >&2
  echo "Consider creating a test file for this module" >&2
fi

exit 0
