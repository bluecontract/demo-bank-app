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
- Region: us-east-1
