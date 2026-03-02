#!/usr/bin/env bash

set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
default_review_env_file="${repo_root}/.code-review.env"
review_env_file="${REVIEW_ENV_FILE:-${default_review_env_file}}"

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "${value}"
}

load_env_file() {
  local file_path="$1"
  local line key value

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="$(trim_whitespace "${line}")"
    [[ -z "${line}" || "${line}" == \#* ]] && continue

    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="$(trim_whitespace "${line}")"
    fi

    if [[ "${line}" != *=* ]]; then
      echo "Skipping invalid env line in ${file_path}: '${line}'" >&2
      continue
    fi

    key="$(trim_whitespace "${line%%=*}")"
    value="${line#*=}"
    value="$(trim_whitespace "${value}")"

    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Skipping invalid env key in ${file_path}: '${key}'" >&2
      continue
    fi

    if [[ "${value}" =~ ^\".*\"$ || "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "${key}=${value}"
  done < "${file_path}"
}

if [[ -f "${review_env_file}" ]]; then
  load_env_file "${review_env_file}"
fi

task="${1:-review}"
ts=$(date -u +"%Y%m%dT%H%M%SZ")
review_dir="agents/skills/code-review/reviews/${task}_${ts}"
prompt_file="${review_dir}/context.md"
result_file="${review_dir}/result.md"
# Default: 600s (10 minutes) per model unless overridden via REVIEW_TIMEOUT_SECONDS.
timeout_seconds="${REVIEW_TIMEOUT_SECONDS:-600}"
if [[ ! "${timeout_seconds}" =~ ^[0-9]+$ || "${timeout_seconds}" -eq 0 ]]; then
  echo "Invalid REVIEW_TIMEOUT_SECONDS='${timeout_seconds}'. Use a positive integer (seconds)." >&2
  exit 1
fi
# Default model set runs all reviewers; local override can narrow this down.
selected_models_raw="${REVIEW_MODELS:-all}"
selected_models="$(echo "${selected_models_raw}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [[ -z "${selected_models}" ]]; then
  selected_models="all"
fi
if [[ ",${selected_models}," == *",all,"* ]]; then
  selected_models="claude,gemini,codex"
fi
# Gemini needs shell tool access to inspect staged diffs via git.
gemini_approval_mode="${GEMINI_APPROVAL_MODE:-yolo}"
gemini_allowed_tools="${GEMINI_ALLOWED_TOOLS:-run_shell_command,read_file,search_file_content,save_memory}"
# Codex defaults are explicit to avoid depending on local ~/.codex model settings.
codex_review_model="${CODEX_REVIEW_MODEL:-gpt-5.2-codex}"
codex_review_fallback_model="${CODEX_REVIEW_FALLBACK_MODEL:-gpt-5-codex}"
codex_review_reasoning_effort="${CODEX_REVIEW_REASONING_EFFORT:-low}"
# Disable MCP for Codex review by default to avoid long tool startup/loops.
codex_disable_playwright_mcp="${CODEX_REVIEW_DISABLE_PLAYWRIGHT_MCP:-true}"
codex_disable_figma_mcp="${CODEX_REVIEW_DISABLE_FIGMA_MCP:-true}"

if git diff --cached --quiet; then
  echo "No staged changes to review." >&2
  exit 1
fi

mkdir -p "$review_dir"

{
  cat <<'EOF'
Task:
Scope:
Key files:
Relevant docs:
Tests run:
Primary risks:
Review instructions:
- Review staged files only (ignore unstaged/untracked).
- Do not propose code changes; report issues only.
Focus areas: High-priority issues only (DRY/SRP, reuse opportunities, regressions, missing tests, security).

Staged files (review only these):
EOF
  git diff --name-only --staged
} > "$prompt_file"

prompt=$(cat "$prompt_file")

detect_timeout_cmd() {
  if command -v timeout >/dev/null 2>&1; then
    echo "timeout"
    return 0
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    echo "gtimeout"
    return 0
  fi
  return 1
}

run_with_timeout() {
  local timeout="$1"
  local out="$2"
  local err="$3"
  shift 3
  local -a cmd=("$@")
  local pid=""
  local pgid=""

  if command -v setsid >/dev/null 2>&1; then
    setsid "${cmd[@]}" > "${out}" 2> "${err}" &
    pid=$!
    pgid=$pid
  else
    "${cmd[@]}" > "${out}" 2> "${err}" &
    pid=$!
  fi

  local start
  start=$(date +%s)
  while kill -0 "${pid}" 2>/dev/null; do
    local now
    now=$(date +%s)
    if (( now - start >= timeout )); then
      if [[ -n "${pgid}" ]]; then
        kill -TERM "-${pgid}" 2>/dev/null || true
      else
        kill -TERM "${pid}" 2>/dev/null || true
      fi
      sleep 5
      if kill -0 "${pid}" 2>/dev/null; then
        if [[ -n "${pgid}" ]]; then
          kill -KILL "-${pgid}" 2>/dev/null || true
        else
          kill -KILL "${pid}" 2>/dev/null || true
        fi
      fi
      wait "${pid}" 2>/dev/null
      return 124
    fi
    sleep 1
  done

  wait "${pid}"
  return $?
}

run_model() {
  local label=$1
  local outfile=$2
  local tool=$3
  shift 3

  local errfile="${outfile}.err"
  local timeout_cmd
  timeout_cmd=$(detect_timeout_cmd || true)
  local cmd=("$tool" "$@")

  if ! command -v "$tool" >/dev/null 2>&1; then
    {
      echo "Review skipped for ${label}."
      echo "Reason: '${tool}' not found in PATH."
    } > "$outfile"
    return 1
  fi

  if [[ -n "$timeout_cmd" ]]; then
    "$timeout_cmd" "$timeout_seconds" "${cmd[@]}" > "$outfile" 2> "$errfile"
  else
    run_with_timeout "$timeout_seconds" "$outfile" "$errfile" "${cmd[@]}"
  fi

  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    {
      echo "Review failed for ${label}."
      echo "Command: ${cmd[*]}"
      echo "Exit code: ${exit_code}"
      if [[ $exit_code -eq 124 || $exit_code -eq 137 ]]; then
        echo "Note: command timed out after ${timeout_seconds}s."
      fi
      if [[ -s "$errfile" ]]; then
        echo ""
        echo "Error output:"
        cat "$errfile"
      fi
    } > "$outfile"
    return 1
  elif [[ ! -s "$outfile" ]]; then
    {
      echo "Review completed with empty output for ${label}."
      echo "Command: ${cmd[*]}"
      if [[ -s "$errfile" ]]; then
        echo ""
        echo "Error output:"
        cat "$errfile"
      fi
    } > "$outfile"
    return 1
  fi

  rm -f "$errfile"
  return 0
}

validate_selected_models() {
  local has_enabled=0
  IFS=',' read -r -a model_list <<< "${selected_models}"
  for model in "${model_list[@]}"; do
    [[ -z "${model}" ]] && continue
    case "${model}" in
      claude|gemini|codex) has_enabled=1 ;;
      *)
        echo "Invalid model in REVIEW_MODELS: '${model}' (allowed: claude,gemini,codex,all)." >&2
        exit 1
        ;;
    esac
  done

  if [[ "${has_enabled}" -eq 0 ]]; then
    echo "No valid models configured in REVIEW_MODELS='${selected_models_raw}'." >&2
    exit 1
  fi
}

is_model_enabled() {
  local target="$1"
  [[ ",${selected_models}," == *,"${target}",* ]]
}

write_model_skipped() {
  local label="$1"
  local outfile="$2"
  cat <<EOF > "${outfile}"
Review skipped for ${label}.
Reason: model disabled by REVIEW_MODELS=${selected_models}.
EOF
}

validate_selected_models

if is_model_enabled "claude"; then
  run_model "claude" "${review_dir}/claude.md" claude --model sonnet -p "$prompt"
else
  write_model_skipped "claude" "${review_dir}/claude.md"
fi

run_gemini_with_fallback() {
  local -a base_args=(--approval-mode "${gemini_approval_mode}")
  IFS=',' read -r -a gemini_tools <<< "${gemini_allowed_tools}"
  for tool_name in "${gemini_tools[@]}"; do
    if [[ -n "${tool_name}" ]]; then
      base_args+=(--allowed-tools "${tool_name}")
    fi
  done

  if run_model "gemini" "${review_dir}/gemini.md" gemini "${base_args[@]}" -m gemini-3-pro-preview -p "$prompt"; then
    return 0
  fi
  run_model "gemini (fallback)" "${review_dir}/gemini.md" gemini "${base_args[@]}" -m gemini-3-flash-preview -p "$prompt"
}

if is_model_enabled "gemini"; then
  run_gemini_with_fallback
else
  write_model_skipped "gemini" "${review_dir}/gemini.md"
fi

run_codex_with_fallback() {
  local outfile="${review_dir}/codex.md"
  local -a codex_args=(
    review
    -c model="${codex_review_model}"
    -c model_reasoning_effort="${codex_review_reasoning_effort}"
  )

  if [[ "${codex_disable_playwright_mcp}" == "true" ]]; then
    codex_args+=(-c mcp_servers.playwright.enabled=false)
  fi
  if [[ "${codex_disable_figma_mcp}" == "true" ]]; then
    codex_args+=(-c mcp_servers.figma.enabled=false)
  fi
  codex_args+=("$prompt")

  if run_model \
    "codex" \
    "${outfile}" \
    codex \
    "${codex_args[@]}"; then
    return 0
  fi

  if [[ -z "${codex_review_fallback_model}" || "${codex_review_fallback_model}" == "${codex_review_model}" ]]; then
    return 1
  fi

  local -a codex_fallback_args=(
    review
    -c model="${codex_review_fallback_model}"
    -c model_reasoning_effort="${codex_review_reasoning_effort}"
  )
  if [[ "${codex_disable_playwright_mcp}" == "true" ]]; then
    codex_fallback_args+=(-c mcp_servers.playwright.enabled=false)
  fi
  if [[ "${codex_disable_figma_mcp}" == "true" ]]; then
    codex_fallback_args+=(-c mcp_servers.figma.enabled=false)
  fi
  codex_fallback_args+=("$prompt")

  run_model \
    "codex (fallback)" \
    "${outfile}" \
    codex \
    "${codex_fallback_args[@]}"
}

if is_model_enabled "codex"; then
  run_codex_with_fallback
else
  write_model_skipped "codex" "${review_dir}/codex.md"
fi

cat <<'EOF' > "$result_file"
# Review Resolution

## High-Priority Issues
- [ ] Item:
  - Source: claude|gemini|codex
  - Decision: accept|defer|reject
  - Rationale:
  - Action taken (if any):

## Lower-Priority/Informational
- [ ] Item:
  - Source:
  - Decision:
  - Rationale:
  - Action taken (if any):
EOF
