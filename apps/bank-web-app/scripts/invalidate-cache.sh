#!/bin/bash

set -e

# Input validation
if [ -z "$1" ]; then
  echo "❌ Usage: $0 <environment>"
  echo "   Example: $0 dev"
  exit 1
fi

ENVIRONMENT=$1
STACK_NAME="demo-blue-frontend-${ENVIRONMENT}"
REGION="eu-central-1"

echo "🔄 Invalidating CloudFront cache for ${ENVIRONMENT} environment..."

# Get the CloudFront Distribution ID from CloudFormation stack outputs
echo "📋 Getting Distribution ID from stack: ${STACK_NAME}"
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text \
  --region "${REGION}")

# Validate that we got a Distribution ID
if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "❌ Failed to get Distribution ID from CloudFormation stack: ${STACK_NAME}"
  echo "🔍 Available outputs:"
  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}" \
    --output table \
    --region "${REGION}" || echo "No outputs found"
  exit 1
fi

echo "✅ Distribution ID: ${DISTRIBUTION_ID}"

# Create CloudFront invalidation
echo "🚀 Creating invalidation for all paths (/*)"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" \
  --region "${REGION}" \
  --query "Invalidation.Id" \
  --output text)

echo "✅ Cache invalidation created successfully!"
echo "📝 Invalidation ID: ${INVALIDATION_ID}"
echo "🔗 Monitor status: https://console.aws.amazon.com/cloudfront/home#distribution-settings:${DISTRIBUTION_ID}"
echo "⏳ Note: Invalidation can take 10-15 minutes to complete" 
