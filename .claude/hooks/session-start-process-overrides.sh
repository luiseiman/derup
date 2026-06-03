#!/usr/bin/env bash
# dotforge v4 — SessionStart hook: process override log
#
# Calls scripts/process-override-log.sh from $DOTFORGE_DIR to capture frequent
# soft_block overrides into practices/inbox/auto-override-*.md.
#
# Non-blocking: always exits 0. Failures are logged to stderr (visible via
# CLAUDE_CODE_DEBUG=hooks) but never prevent session start.
#
# Configuration: see scripts/process-override-log.sh

set -uo pipefail

# Skip silently if DOTFORGE_DIR is not set (project not bootstrapped via dotforge)
if [[ -z "${DOTFORGE_DIR:-}" ]]; then
  exit 0
fi

SCRIPT="${DOTFORGE_DIR}/scripts/process-override-log.sh"

# Skip if dotforge has v3 only (no v4 script yet)
if [[ ! -x "$SCRIPT" ]]; then
  exit 0
fi

# Run with a short timeout to never block session start.
# Portable: prefer gtimeout (macOS+coreutils) then timeout (Linux), else run unbounded.
if command -v gtimeout >/dev/null 2>&1; then
  gtimeout 5 "$SCRIPT" 2>&1 | head -3 1>&2 || true
elif command -v timeout >/dev/null 2>&1; then
  timeout 5 "$SCRIPT" 2>&1 | head -3 1>&2 || true
else
  # No timeout binary (macOS without coreutils). Script has internal early-exits
  # and bounded work (file size). Run unbounded; suppress errors to never block.
  "$SCRIPT" 2>&1 | head -3 1>&2 || true
fi

exit 0
