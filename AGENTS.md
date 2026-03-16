# AGENTS

## Source of Truth

The canonical workflow and rules live in `.cursor/rules`. Start with:

- `.cursor/rules/fullcycle-core.mdc`
- Use the phase-specific rules and implementation guardrails as needed.

## Approval Gates

Problem exploration, requirements, and design artifacts require explicit approval.
Implementation runs autonomously until verify + review steps are complete.

## Process Improvements (Required)

If you hit any friction (tests fail due to missing steps, ports, missing docs, unclear commands, etc.), do not apply only an ad-hoc fix. Propose a change to the workflow, scripts, or docs so the issue won’t repeat. Log the recommendation in the chat and ask for approval to implement it.

## LocalStack (Worktrees)

Parallel agents should use per-worktree LocalStack settings:

- Create `.localstack.env` at repo root with unique `LOCALSTACK_CONTAINER_NAME`,
  `LOCALSTACK_EDGE_PORT`, and (optionally) `LOCALSTACK_PORT_RANGE`.
- Set per-worktree app ports: `BANK_API_PORT` and `WEB_APP_PORT` (plus
  `WEB_APP_PREVIEW_PORT` if needed).
- To keep secrets out of git, pass a shared secrets JSON to
  `scripts/setup-worktree-localstack.sh` (it merges into
  `apps/bank-api/env.local.worktree.json`).
- Set `AWS_ENDPOINT_URL` for host-side tools/tests and
  `LOCALSTACK_DOCKER_ENDPOINT_URL` for SAM containers.
- Copy `apps/bank-api/env.local.json` to a worktree-specific env file (for
  example `apps/bank-api/env.local.worktree.json`) and update
  `AWS_ENDPOINT_URL`/`AwsEndpointUrl` to match `LOCALSTACK_DOCKER_ENDPOINT_URL`.
- Source `.localstack.env` (or use direnv) before running Nx commands.
- Helper script: `scripts/setup-worktree-localstack.sh wt1 4567 5510-5559`.
- Helper script can auto-pick nearest free ports when you omit them (use short
  worktree IDs like `wt1`, `qa`, `ux`).
- If ports are auto-picked, report the chosen values from the script output or
  `.localstack.env`. Auto-picks are cached per worktree to avoid collisions
  (registry in `${TMPDIR:-/tmp}/demo-bank-app-localstack-ports.registry`).
- `scripts/setup-worktree-localstack.sh` writes `LOCALSTACK_WORKTREE_ID` and
  `LOCALSTACK_CONTAINER_LABEL` so LocalStack containers are labeled per worktree.
- `scripts/stop-worktree-localstack.sh` only stops containers matching the
  current worktree label.
- Stop helper: `scripts/stop-worktree-localstack.sh`.

## Cursor Cloud specific instructions

- This repo provides a repo-level Cursor Cloud environment via:
  - `.cursor/environment.json`
  - `.cursor/Dockerfile.cloud`
- Cloud startup runs `scripts/start-cursor-cloud.sh`, which:
  - starts Docker for the cloud VM
  - prepares `.localstack.env` with the correct Docker-host endpoint for SAM containers
- In fresh shells, run `source .localstack.env` before LocalStack/SAM/Nx commands.
- For local full-stack verification in cloud agents:
  1. `source .localstack.env`
  2. `npm run serve:all`
  3. `npm run verify:full`
- If `verify:full` is too long-lived for the current cloud session, use
  `npm run verify:full:stepwise` instead so each phase is visible and resumable.
- Resume stepwise verify with `VERIFY_FULL_STEP_FROM=<step> npm run verify:full:stepwise`.
- Prefer `npm run verify:full:resume -- <step>` over the env-var form when resuming from a failure.
- Step names:
  - `web-build`
  - `lint`
  - `typecheck`
  - `build-all`
  - `test-all`
  - `test-integration-all`
  - `e2e`
- `npm run e2e` and the final E2E phase of `npm run verify:full` expect the local stack to already be running.
- Prefer Cursor Secrets / workspace secrets for API keys and env vars required by local verification.

## Git Commits (Required)

- Work in reasonable increments; avoid micro-commits and avoid one giant commit for a large change.
- Use Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) with an optional scope.
- Before each commit, stage the intended changes and run the staged-only code review (see `agents/skills/code-review`).
- If external reviewer CLIs (`claude`, `gemini`, `codex`) are unavailable in the
  current sandbox, the code-review step falls back to self-review; call that out
  explicitly in the handoff/final response or note that external review is delivered separately.
- Before each commit, ensure Quick Verify passes (husky will enforce formatting/tests on commit).
- If tests cannot run, state why in the commit body and in the final response.

## Skills

Skills live in `agents/skills/*` and include:

- `agents/skills/tests`
- `agents/skills/debug`
- `agents/skills/logs`
- `agents/skills/deploy`
- `agents/skills/code-review`

## Artifacts

- Problem exploration: `docs/problem-exploration/`
- Requirements: `docs/requirements/`
- Design: `docs/design/`
- ADRs: `docs/adr/`
- Plan updates: `docs/plan.md`

## Blue Objects (Required)

- Before implementing or reviewing flows that parse, validate, or transform Blue payloads/events/documents, read and follow `docs/adr/009-blue-document-handling.md`.
- Do not introduce raw JSON fallbacks/workarounds for Blue objects when `blue.*` APIs and schema-based flows are required by the ADR.
