---
name: tests
description: Run local quality checks and test suites for demo-bank-app.
---

# Quick Verify

Run after implementation work (or before review).

```bash
npm run verify:quick
```

# Full Verify

Run after Quick Verify for feature or major changes.

```bash
npm run verify:full
```

# Targeted Runs

- Unit/watch: `npm run test:watch`
- API integration: `npx nx run @demo-bank-app/bank-api:test:integration`
- E2E (local, stack already running): `npm run e2e`
- E2E (dev): `npm run e2e:dev`
- E2E (prod): `npm run e2e:prod`

Note: `npm run e2e` expects the local stack to be running (`npm run serve:all` or `npm run serve:stack`).
For worktrees, `source .localstack.env` so integration tests use the correct LocalStack endpoint and app ports.
Use `scripts/stop-worktree-localstack.sh` to cleanly stop ports + LocalStack after tests.

# Capture Output (optional)

Store logs in `agents/skills/tests/executions/`.

```bash
mkdir -p agents/skills/tests/executions
ts=$(date -u +"%Y%m%dT%H%M%SZ")
npm run test | tee "agents/skills/tests/executions/unit_${ts}.log"
```
