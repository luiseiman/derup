#!/usr/bin/env bash
# Setup hook — runs on `claude --init-only` and `claude --maintenance`.
# Validates dotforge invariants before any session starts.
#
# Matchers:
#   init        — fires on --init-only (one-shot validation, no session)
#   maintenance — fires on --maintenance (periodic checks)
#
# Exit codes:
#   0 — all invariants pass
#   2 — critical errors found, block session start
#
# Checks:
#   1. .claude/settings.json valid JSON
#   2. block-destructive.sh present and executable (security-critical)
#   3. behaviors/index.yaml valid YAML (if exists)
#   4. All wired hooks exist and are executable
#   5. DOTFORGE_DIR resolves (warn only)
#
# Output: silent on success, prints checklist on any error/warning.

set -uo pipefail

ERRORS=()
WARNINGS=()

# 1. settings.json valid JSON
if [ -f .claude/settings.json ]; then
    if ! python3 -c "import json; json.load(open('.claude/settings.json'))" >/dev/null 2>&1; then
        ERRORS+=("settings.json is not valid JSON")
    fi
else
    WARNINGS+=("settings.json not found (running outside a configured project?)")
fi

# 2. block-destructive.sh — security-critical
if [ -f .claude/hooks/block-destructive.sh ]; then
    if [ ! -x .claude/hooks/block-destructive.sh ]; then
        ERRORS+=("block-destructive.sh exists but is NOT executable (chmod +x required)")
    fi
else
    WARNINGS+=("block-destructive.sh not found — security baseline missing")
fi

# 3. behaviors/index.yaml (v3 governance, if present)
if [ -f behaviors/index.yaml ]; then
    if ! python3 -c "import yaml; yaml.safe_load(open('behaviors/index.yaml'))" >/dev/null 2>&1; then
        ERRORS+=("behaviors/index.yaml is not valid YAML")
    fi
fi

# 4. All wired hooks exist and are executable
if [ -f .claude/settings.json ]; then
    HOOK_PATHS=$(python3 -c "
import json, sys
try:
    s = json.load(open('.claude/settings.json'))
    for ev, lst in s.get('hooks', {}).items():
        for entry in lst:
            for h in entry.get('hooks', []):
                cmd = h.get('command') if isinstance(h, dict) else h
                if cmd: print(cmd)
except Exception:
    pass
" 2>/dev/null)

    while IFS= read -r path; do
        [ -z "$path" ] && continue
        # Skip non-file hook types (http, builtin, etc.)
        case "$path" in
            http://*|https://*|builtin:*) continue ;;
        esac
        if [ ! -f "$path" ]; then
            ERRORS+=("Wired hook missing: $path")
        elif [ ! -x "$path" ]; then
            ERRORS+=("Wired hook not executable: $path")
        fi
    done <<< "$HOOK_PATHS"
fi

# 5. DOTFORGE_DIR resolution (warn only, doesn't block)
if [ -n "${DOTFORGE_DIR:-}" ] && [ ! -d "$DOTFORGE_DIR" ]; then
    WARNINGS+=("DOTFORGE_DIR=$DOTFORGE_DIR does not exist on disk")
fi

# Report
TOTAL=$(( ${#ERRORS[@]} + ${#WARNINGS[@]} ))

if [ "$TOTAL" -eq 0 ]; then
    echo "✓ dotforge pre-session check: all invariants pass"
    exit 0
fi

echo "── dotforge pre-session check ──"
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "Errors (${#ERRORS[@]}):"
    for err in "${ERRORS[@]}"; do echo "  ✗ $err"; done
fi
if [ ${#WARNINGS[@]} -gt 0 ]; then
    echo ""
    echo "Warnings (${#WARNINGS[@]}):"
    for warn in "${WARNINGS[@]}"; do echo "  ⚠ $warn"; done
fi
echo "─────────────────────────────────"

if [ ${#ERRORS[@]} -gt 0 ]; then
    exit 2
fi
exit 0
