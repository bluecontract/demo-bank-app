---
name: debug
description: Structured workflow for investigating issues in demo-bank-app.
---

# Debug Workflow

1. Reproduce the issue and capture the exact error output.
2. Identify scope (API, web app, E2E, tooling).
3. Gather context: recent changes, env vars, and logs (see logs skill).
4. Form a hypothesis and verify with a minimal experiment.
5. Implement the smallest fix and add a regression test if applicable.
6. Run Quick Verify; run Full Verify if the change is non-trivial.
7. Summarize root cause, fix, and remaining risks.

# Capture Notes (optional)

Store investigation notes in `agents/skills/debug/executions/<issue>_<timestamp>.md`.
