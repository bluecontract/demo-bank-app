---
name: logs
description: Fetch local logs for the bank API, web app, and LocalStack.
---

# Local Logs

- LocalStack status: `npx nx run localstack:status`
- LocalStack logs: `docker logs -f ${LOCALSTACK_CONTAINER_NAME:-localstack-demo-bank-app}`
- Summary lambda logs (LocalStack CloudWatch):
  `AWS_REGION=eu-west-1 aws --endpoint-url ${AWS_ENDPOINT_URL:-http://localhost:4566} logs tail "/aws/lambda/blue-bank-summary-dev" --follow`
- API logs: keep the `npx nx serve @demo-bank-app/bank-api` terminal open.
- Web app logs: keep the `npx nx serve @demo-bank-app/bank-web-app` terminal open.
- API health: `curl -s http://localhost:3000/health`

# Notes

- For AWS logs, add commands here once remote environments are introduced.
- Requires AWS CLI for summary lambda log tail.
- For worktrees, `source .localstack.env` so status/log commands use the correct container and endpoint.
