---
name: code-review
description: Run automated code reviews (Claude, Gemini, Codex) and store outputs with DRY/SRP focus.
---

# When to Use

- After Quick Verify for small tasks.
- After Full Verify for feature or major changes.
- Always before committing (review staged-only changes).

# Review Prompt Template

```
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
```

# Staged-Only Enforcement

Review only staged changes. Unstaged/untracked files are allowed, but **all agent-implemented changes that are meant to be reviewed must be staged** before running the review.

```bash
if git diff --cached --quiet; then echo "No staged changes to review."; exit 1; fi
```

# Output Locations

- Review bundle: `agents/skills/code-review/reviews/<task>_<timestamp>/`
  - Context: `context.md`
  - Claude: `claude.md`
  - Gemini: `gemini.md`
  - Codex: `codex.md`
  - Review resolution: `result.md`

# Preferred Script

Use the script below to ensure timeouts and model failures are recorded without breaking the review flow:

```bash
agents/skills/code-review/scripts/run-review.sh short-slug
```

Notes:

- Configure timeout with `REVIEW_TIMEOUT_SECONDS` (default: 600 seconds per model).
- Gemini is run with shell/git tool access by default so it can inspect staged diffs directly:
  - `GEMINI_APPROVAL_MODE` (default: `yolo`)
  - `GEMINI_ALLOWED_TOOLS` (default: `run_shell_command,read_file,search_file_content,save_memory`)
- Codex uses explicit defaults and fallback to avoid local config drift:
  - `CODEX_REVIEW_MODEL` (default: `gpt-5.2-codex`)
  - `CODEX_REVIEW_FALLBACK_MODEL` (default: `gpt-5-codex`)
  - `CODEX_REVIEW_REASONING_EFFORT` (default: `low`)
- If a model fails or times out, its output file will contain the error details.

# Command Template (manual fallback)

```bash
ts=$(date -u +"%Y%m%dT%H%M%SZ")
task="short-slug"
review_dir="agents/skills/code-review/reviews/${task}_${ts}"
mkdir -p "$review_dir"
prompt_file="${review_dir}/context.md"
result_file="${review_dir}/result.md"

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

claude --model sonnet -p "$prompt" > "${review_dir}/claude.md"
gemini --approval-mode yolo \
  --allowed-tools run_shell_command \
  --allowed-tools read_file \
  --allowed-tools search_file_content \
  --allowed-tools save_memory \
  -m gemini-3-pro-preview -p "$prompt" > "${review_dir}/gemini.md" \
  || gemini --approval-mode yolo \
    --allowed-tools run_shell_command \
    --allowed-tools read_file \
    --allowed-tools search_file_content \
    --allowed-tools save_memory \
    -m gemini-3-flash-preview -p "$prompt" > "${review_dir}/gemini.md"
# Prefer explicit model settings for reproducibility.
codex review -c model="gpt-5.2-codex" -c model_reasoning_effort="low" "$prompt" > "${review_dir}/codex.md"

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
```

# Base Branch Reviews

- For reviewing committed branch changes, use `codex review --base main`.

# Review Handling

- Focus reviewers on high-priority issues (bugs, regressions, security, missing tests, DRY/SRP violations).
- Triage the feedback: verify each point against the staged diff and decide accept/defer/reject.
- Record decisions and rationale in `result.md`, including what was changed or why it was skipped.
- Prioritize DRY/SRP and reuse opportunities.
- Call out any behavior changes or missing tests.
