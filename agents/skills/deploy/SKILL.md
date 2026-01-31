---
name: deploy
description: Local-only serving and deployment steps for demo-bank-app (AWS steps TBD).
---

# Local Serving

```bash
npm run serve:all
```

# Targeted Local Runs

- API only: `npx nx serve @demo-bank-app/bank-api`
- Web app only: `npx nx serve @demo-bank-app/bank-web-app`
- LocalStack only: `npx nx serve localstack`

# Notes

- AWS deployment steps will be added later, when remote environments are introduced.
