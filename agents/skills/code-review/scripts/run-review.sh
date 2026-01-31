#!/usr/bin/env bash

set -u

task="${1:-review}"
ts=$(date -u +"%Y%m%dT%H%M%SZ")
review_dir="agents/skills/code-review/reviews/${task}_${ts}"
prompt_file="${review_dir}/context.md"
result_file="${review_dir}/result.md"
timeout_seconds="${REVIEW_TIMEOUT_SECONDS:-300}"

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

run_model() {
  local label=$1
  local outfile=$2
  shift 2

  local errfile="${outfile}.err"
  local timeout_cmd
  timeout_cmd=$(detect_timeout_cmd || true)

  if [[ -n "$timeout_cmd" ]]; then
    "$timeout_cmd" "$timeout_seconds" "$@" > "$outfile" 2> "$errfile"
  else
    "$@" > "$outfile" 2> "$errfile"
  fi

  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    {
      echo "Review failed for ${label}."
      echo "Command: $*"
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
  fi

  rm -f "$errfile"
}

run_model "claude" "${review_dir}/claude.md" claude --model sonnet -p "$prompt"
run_model "gemini" "${review_dir}/gemini.md" gemini -m gemini-2.5-pro "$prompt"
run_model "codex" "${review_dir}/codex.md" codex review -c model="codex-5.2-codex" "$prompt"

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
