---
name: deploy
description: Local-only serving and deployment steps for demo-bank-app (AWS steps TBD).
---

# Local Serving

```bash
npm run serve:all
```

# Worktrees / Parallel Agents

If running in a git worktree, load the per-worktree LocalStack config first:

```bash
source .localstack.env
```

Setup helper:

```bash
scripts/setup-worktree-localstack.sh wt1 4567 5510-5559 3001 4201 /Users/you/secrets/demo-bank-app.bank-api.json
```

Auto-pick nearest free ports:

```bash
scripts/setup-worktree-localstack.sh wt1
```

Report chosen ports from the script output or `.localstack.env`.

Stop helper:

```bash
scripts/stop-worktree-localstack.sh
```

# Targeted Local Runs

- API only: `npx nx serve @demo-bank-app/bank-api`
- Web app only: `npx nx serve @demo-bank-app/bank-web-app`
- LocalStack only: `npx nx serve localstack`

# Notes

- AWS deployment steps will be added later, when remote environments are introduced.
