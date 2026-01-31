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

## Git Commits (Required)

- Work in reasonable increments; avoid micro-commits and avoid one giant commit for a large change.
- Use Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) with an optional scope.
- Before each commit, stage the intended changes and run the staged-only code review (see `agents/skills/code-review`).
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
