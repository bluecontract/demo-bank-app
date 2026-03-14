# LocalStack Service

LocalStack provides the **native** local AWS emulation path for development and testing.
It is still used whenever Docker + SAM tooling are available.

## Prerequisites

- **Docker** - LocalStack runs directly as a Docker container

## Usage

### Via top-level commands (recommended)

```bash
# Start the full local stack
npm run serve:all

# Start only the backend/AWS stack
npm run serve:stack
```

These commands auto-detect whether to use:

- the native Docker + LocalStack + SAM path, or
- the sandbox fallback path

### Via Nx (native-only)

```bash
# Start LocalStack
nx serve localstack

# Stop LocalStack
nx stop localstack

# Check LocalStack health
nx status localstack
```

## Services Enabled

- Lambda
- API Gateway
- DynamoDB
- SSM Parameter Store
- S3

All services are available at: `http://localhost:4566`

## Environment

- Endpoint: http://localhost:4566
- AWS Access Key: test
- AWS Secret Key: test
- Region: eu-west-1 (project default)
