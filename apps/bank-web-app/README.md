# Bank Web App - Frontend Infrastructure

This application deploys a secure static website using modern AWS best practices with **CloudFront** and **Origin Access Control (OAC)**.

## Architecture

```
User Request → CloudFront (CDN) → S3 (Private Bucket)
```

### Key Components

- **S3 Bucket**: Private bucket storing static assets
- **CloudFront Distribution**: CDN serving content globally with HTTPS
- **Origin Access Control (OAC)**: Secure access from CloudFront to S3
- **Cache Invalidation**: Automatic cache clearing on deployment

## Security Features

✅ **Private S3 Bucket**: No public access, only CloudFront can read  
✅ **HTTPS Only**: All traffic encrypted in transit  
✅ **Origin Access Control**: Modern replacement for deprecated OAI  
✅ **SPA Support**: Proper error handling for single-page applications

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. SAM CLI installed
3. Build artifacts in `dist/apps/bank-web-app/`

### Deploy Infrastructure & Assets

```bash
# From the bank-web-app directory
npx nx deploy bank-web-app --environment=dev
```

This command:

1. 🏗️ Deploys CloudFront + S3 infrastructure via SAM
2. 📦 Syncs built assets to S3 bucket
3. 🔄 Invalidates CloudFront cache for immediate updates
4. ✅ Outputs the CloudFront distribution URL

### Manual Deployment Steps

```bash
# 1. Deploy infrastructure
sam deploy --config-env dev --no-confirm-changeset --no-fail-on-empty-changeset

# 2. Sync assets to S3
aws s3 sync dist/apps/bank-web-app s3://demo-blue-frontend-dev --delete

# 3. Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name demo-blue-frontend-dev --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' --output text)
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths '/*'
```

## Configuration

### Environment-Specific Settings

- **dev**: `demo-blue-frontend-dev` stack
- **prod**: `demo-blue-frontend-prod` stack

### SAM Configuration

See `samconfig.toml` for environment-specific parameters:

- Stack names
- S3 deployment buckets
- Parameters and tags

### CloudFront Cache

- **Cache Policy**: AWS Managed CachingOptimized
- **TTL**: Automatic based on file types
- **Invalidation**: Automatic on deployment (`/*` paths)

## Development

For local development, the frontend runs independently:

```bash
# Start development server
npx nx serve bank-web-app

# Build for production
npx nx build bank-web-app
```

## Monitoring

CloudFront provides built-in monitoring:

- **Access Logs**: Automatically enabled
- **Real-time Metrics**: Available in CloudWatch
- **Cache Hit Ratio**: Monitor via AWS Console

---

**Note**: This uses the modern **Origin Access Control (OAC)** approach, replacing the deprecated Origin Access Identity (OAI). The S3 bucket remains completely private while still serving content globally via CloudFront.
