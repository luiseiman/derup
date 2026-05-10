#!/usr/bin/env bash
# SessionStart hook: notify if dotforge has updates available
# Silent unless updates found. Designed for < 2s execution.
# Requires: DOTFORGE_DIR env var or ~/Documents/GitHub/dotforge default

DOTFORGE_DIR="${DOTFORGE_DIR:-$HOME/Documents/GitHub/dotforge}"

# Skip if dotforge dir doesn't exist
[[ -d "$DOTFORGE_DIR" ]] || exit 0

# Get current dotforge version
CK_VERSION=$(cat "$DOTFORGE_DIR/VERSION" 2>/dev/null | tr -d '[:space:]')
[[ -z "$CK_VERSION" ]] && exit 0

# --- Check 1: project version vs dotforge version ---
PROJECT_VERSION=""
MANIFEST=".claude/.forge-manifest.json"
if [[ -f "$MANIFEST" ]]; then
  PROJECT_VERSION=$(jq -r '.dotforge_version // empty' "$MANIFEST" 2>/dev/null)
fi

# Fallback: check registry for this project path
if [[ -z "$PROJECT_VERSION" ]]; then
  PROJECT_PATH="$(pwd)"
  REGISTRY="$DOTFORGE_DIR/registry/projects.yml"
  if [[ -f "$REGISTRY" ]]; then
    # Extract version for matching path (simple grep, no yq dependency)
    PROJECT_VERSION=$(awk -v path="$PROJECT_PATH" '
      /^  - name:/ { in_project=0 }
      /path:/ && index($0, path) { in_project=1 }
      in_project && /dotforge_version:/ { gsub(/.*dotforge_version: */, ""); print; exit }
    ' "$REGISTRY")
  fi
fi

# --- Check 2: remote updates (non-blocking, timeout 3s) ---
REMOTE_AHEAD=0
if [[ -d "$DOTFORGE_DIR/.git" ]]; then
  # Portable timeout: try timeout, then gtimeout (macOS brew), then skip
  if command -v timeout &>/dev/null; then
    FETCH_OUTPUT=$(cd "$DOTFORGE_DIR" && timeout 3 git fetch --dry-run 2>&1)
  elif command -v gtimeout &>/dev/null; then
    FETCH_OUTPUT=$(cd "$DOTFORGE_DIR" && gtimeout 3 git fetch --dry-run 2>&1)
  else
    FETCH_OUTPUT=""
  fi
  if [[ -n "$FETCH_OUTPUT" ]] && echo "$FETCH_OUTPUT" | grep -q "main"; then
    REMOTE_AHEAD=1
  fi
fi

# --- Output only if something to report ---
MSGS=()

if [[ -n "$PROJECT_VERSION" && "$PROJECT_VERSION" != "$CK_VERSION" ]]; then
  MSGS+=("⬆ dotforge $PROJECT_VERSION → $CK_VERSION available. Run /forge sync to update.")
fi

if [[ "$REMOTE_AHEAD" -eq 1 ]]; then
  MSGS+=("⬆ dotforge remote has new commits. Run: cd $DOTFORGE_DIR && git pull")
fi

if [[ ${#MSGS[@]} -gt 0 ]]; then
  echo "──── dotforge update check ────"
  for msg in "${MSGS[@]}"; do
    echo "$msg"
  done
  echo "─────────────────────────────────"
fi

exit 0
