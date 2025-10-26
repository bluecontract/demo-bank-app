#!/bin/bash

# Create SAM deployment buckets
# Run this script with AWS CLI configured with demo-bank-app-private-aws profile

set -e

# Configuration
AWS_PROFILE="demo-bank-app-private-aws"
AWS_REGION="eu-west-1"

echo "🪣 Creating SAM deployment buckets..."
echo "AWS Profile: ${AWS_PROFILE}"
echo "AWS Region: ${AWS_REGION}"

# Create deployment buckets for SAM
for env in dev prod; do
  bucket_name="demo-bank-app-deployments-${env}"
  echo "Creating bucket: ${bucket_name}"

  aws s3 mb s3://${bucket_name} \
    --profile ${AWS_PROFILE} \
    --region ${AWS_REGION} \
    || echo "Bucket ${bucket_name} might already exist"

  # Enable versioning for deployment buckets (good practice)
  aws s3api put-bucket-versioning \
    --profile ${AWS_PROFILE} \
    --bucket ${bucket_name} \
    --versioning-configuration Status=Enabled \
    || echo "Versioning might already be enabled for ${bucket_name}"
done

echo ""
echo "✅ SAM deployment buckets ready!"
echo ""
echo "📦 You can now deploy your applications:"
echo "1. Deploy web-app infrastructure: cd apps/bank-web-app && sam deploy --config-env dev --profile ${AWS_PROFILE}"
echo "2. Deploy lambda infrastructure: cd apps/bank-api && sam deploy --config-env dev --profile ${AWS_PROFILE}"
