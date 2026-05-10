#!/usr/bin/env bash
# PostToolUse hook: detect new stack dependencies and warn about uninstalled dotforge stacks
# Matcher: Write|Edit
# Exit: always 0 (warning only — never blocks)
#
# When Claude writes to a dependency file (package.json, pyproject.toml, go.mod, etc.),
# this hook reads the file, extracts package names, and checks whether any imply a
# dotforge stack that isn't installed in the project. Emits a warning to stderr.

FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('file_path', d.get('path', '')))" 2>/dev/null || echo "")

# Only process known dependency files
case "$(basename "$FILE_PATH")" in
  package.json|pyproject.toml|requirements.txt|Pipfile|go.mod|pom.xml|build.gradle|build.gradle.kts|Gemfile|Gemfile.lock) ;;
  *) exit 0 ;;
esac

[[ ! -f "$FILE_PATH" ]] && exit 0

# --- Read installed stacks from forge manifest ---
MANIFEST=".claude/.forge-manifest.json"
INSTALLED_STACKS=""
if [[ -f "$MANIFEST" ]]; then
  # Extract stacks from manifest: check 'stacks' array first,
  # fallback to inferring from file sources (stacks/<name>)
  INSTALLED_STACKS=$(python3 -c "
import json, re
try:
  d = json.load(open('$MANIFEST'))
  stacks = d.get('stacks', [])
  if not stacks:
    # Infer from file sources: 'stacks/react-vite-ts' -> 'react-vite-ts'
    for f in d.get('files', {}).values():
      src = f.get('source', '') if isinstance(f, dict) else ''
      m = re.match(r'stacks/([^/]+)', src)
      if m and m.group(1) not in stacks:
        stacks.append(m.group(1))
  print(' '.join(stacks))
except Exception:
  pass
" 2>/dev/null || echo "")
fi

stack_installed() {
  echo "$INSTALLED_STACKS" | grep -qw "$1"
}

WARNINGS=()

# --- Stack detection patterns ---

case "$(basename "$FILE_PATH")" in

  package.json)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "{}")

    # react-vite-ts: react or vite present
    if echo "$CONTENT" | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}), **d.get('devDependencies',{})}; sys.exit(0 if 'react' in deps or 'vite' in deps or 'next' in deps else 1)" 2>/dev/null; then
      stack_installed "react-vite-ts" || WARNINGS+=("react/vite detected → stack react-vite-ts not installed. Run: /forge sync")
    fi

    # node-express: express or fastify present, no react/vite
    if echo "$CONTENT" | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}), **d.get('devDependencies',{})}; has_server='express' in deps or 'fastify' in deps or 'koa' in deps; has_frontend='react' in deps or 'vite' in deps or 'next' in deps; sys.exit(0 if has_server and not has_frontend else 1)" 2>/dev/null; then
      stack_installed "node-express" || WARNINGS+=("express/fastify detected → stack node-express not installed. Run: /forge sync")
    fi

    # supabase: @supabase/supabase-js present
    if echo "$CONTENT" | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}), **d.get('devDependencies',{})}; sys.exit(0 if any('supabase' in k for k in deps) else 1)" 2>/dev/null; then
      stack_installed "supabase" || WARNINGS+=("@supabase detected → stack supabase not installed. Run: /forge sync")
    fi

    # redis: ioredis or redis package
    if echo "$CONTENT" | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}), **d.get('devDependencies',{})}; sys.exit(0 if 'ioredis' in deps or 'redis' in deps else 1)" 2>/dev/null; then
      stack_installed "redis" || WARNINGS+=("redis/ioredis detected → stack redis not installed. Run: /forge sync")
    fi
    ;;

  pyproject.toml|requirements.txt|Pipfile)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")

    # python-fastapi
    if echo "$CONTENT" | grep -qiE '(fastapi|uvicorn|starlette|pydantic)'; then
      stack_installed "python-fastapi" || WARNINGS+=("fastapi/uvicorn detected → stack python-fastapi not installed. Run: /forge sync")
    fi

    # redis
    if echo "$CONTENT" | grep -qiE '^redis|"redis"|redis=|redis~'; then
      stack_installed "redis" || WARNINGS+=("redis detected → stack redis not installed. Run: /forge sync")
    fi

    # gcp-cloud-run
    if echo "$CONTENT" | grep -qiE '(google-cloud|google\.cloud|gcloud)'; then
      stack_installed "gcp-cloud-run" || WARNINGS+=("google-cloud SDK detected → stack gcp-cloud-run not installed. Run: /forge sync")
    fi

    # data-analysis
    if echo "$CONTENT" | grep -qiE '(pandas|numpy|scikit.learn|jupyter|matplotlib|seaborn|polars)'; then
      stack_installed "data-analysis" || WARNINGS+=("pandas/numpy/jupyter detected → stack data-analysis not installed. Run: /forge sync")
    fi
    ;;

  go.mod)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
    if echo "$CONTENT" | grep -qE '^module |^require'; then
      stack_installed "go-api" || WARNINGS+=("go.mod detected → stack go-api not installed. Run: /forge sync")
    fi
    ;;

  pom.xml|build.gradle|build.gradle.kts)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
    if echo "$CONTENT" | grep -qiE '(spring-boot|springframework|spring.boot)'; then
      stack_installed "java-spring" || WARNINGS+=("Spring Boot detected → stack java-spring not installed. Run: /forge sync")
    fi
    ;;

  Gemfile|Gemfile.lock)
    stack_installed "ruby" || true  # No ruby stack yet — skip
    ;;

esac

# --- Also check for MCP server implications ---
case "$(basename "$FILE_PATH")" in
  package.json)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "{}")
    if echo "$CONTENT" | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}), **d.get('devDependencies',{})}; sys.exit(0 if any('supabase' in k for k in deps) else 1)" 2>/dev/null; then
      [[ ! -f ".claude/rules/mcp-supabase.md" ]] && WARNINGS+=("@supabase in deps → MCP template available: /forge mcp add supabase")
    fi
    ;;
  pyproject.toml|requirements.txt)
    CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
    if echo "$CONTENT" | grep -qiE '(redis)'; then
      [[ ! -f ".claude/rules/mcp-redis.md" ]] && WARNINGS+=("redis in deps → MCP template available: /forge mcp add redis")
    fi
    ;;
esac

# --- Emit warnings ---
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo "" >&2
  echo "⚡ stack-drift detected in $(basename "$FILE_PATH"):" >&2
  for w in "${WARNINGS[@]}"; do
    echo "   • $w" >&2
  done
  echo "" >&2
fi

exit 0
