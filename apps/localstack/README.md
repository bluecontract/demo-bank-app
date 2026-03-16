# LocalStack Service

LocalStack provides local AWS cloud service emulation for development and testing.

## Prerequisites

- **Docker** - LocalStack runs directly as a Docker container

## Usage

### Via Nx (Recommended)

```bash
# Start LocalStack
nx serve localstack

# Stop LocalStack
nx stop localstack

# Check LocalStack health
nx status localstack
```

### Worktrees / Parallel Agents

LocalStack can run per git worktree by setting the following environment
variables (defaults shown):

- `LOCALSTACK_CONTAINER_NAME=localstack-demo-bank-app`
- `LOCALSTACK_EDGE_PORT=4566`
- `LOCALSTACK_PORT_RANGE=4510-4559` (set empty to disable)
- `LOCALSTACK_IMAGE=localstack/localstack`
- `LOCALSTACK_ENV_FILE` (optional path to a `.localstack.env` file)

Create a `.localstack.env` in the repo root for each worktree and run:

```bash
nx serve localstack
```

The LocalStack Nx scripts auto-load `.localstack.env` when present.
For parallel worktrees, pick unique `LOCALSTACK_EDGE_PORT` and
`LOCALSTACK_PORT_RANGE` values.

Helper: `scripts/setup-worktree-localstack.sh wt1 4567 5510-5559 3001 4201`
Stop helper: `scripts/stop-worktree-localstack.sh`
Auto ports: `scripts/setup-worktree-localstack.sh wt1`

## Services Enabled

- Lambda
- API Gateway
- DynamoDB
- SSM Parameter Store
- S3

All services are available at: `http://localhost:${LOCALSTACK_EDGE_PORT}`.

## Environment

- Endpoint: `http://localhost:${LOCALSTACK_EDGE_PORT}`
- AWS Access Key: test
- AWS Secret Key: test
- Region: us-east-1
