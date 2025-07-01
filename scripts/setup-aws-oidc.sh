#!/bin/bash

# AWS OIDC Setup Script for GitHub Actions
# Run this script with AWS CLI configured with kamil-private-aws profile

set -e

# Configuration
GITHUB_USERNAME="kgruszka"
REPO_NAME="demo-blue"
ROLE_NAME="GitHubActionsRole"
POLICY_NAME="GitHubActionsCICDPolicy"
AWS_PROFILE="kamil-private-aws"
AWS_REGION="eu-central-1"

echo "🔧 Setting up AWS OIDC for GitHub Actions..."
echo "Repository: ${GITHUB_USERNAME}/${REPO_NAME}"
echo "AWS Profile: ${AWS_PROFILE}"
echo "AWS Region: ${AWS_REGION}"

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile ${AWS_PROFILE} --query Account --output text)
echo "AWS Account ID: ${ACCOUNT_ID}"

# 1. Create OIDC Identity Provider (if it doesn't exist)
echo "📋 Creating OIDC Identity Provider..."
aws iam create-open-id-connect-provider \
  --profile ${AWS_PROFILE} \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com \
  || echo "OIDC Provider already exists"

# 2. Create Trust Policy
echo "📝 Creating trust policy..."
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_USERNAME}/${REPO_NAME}:*"
        }
      }
    }
  ]
}
EOF

# 3. Create IAM Role
echo "🎭 Creating IAM Role..."
ROLE_ARN=$(aws iam create-role \
  --profile ${AWS_PROFILE} \
  --role-name ${ROLE_NAME} \
  --assume-role-policy-document file://trust-policy.json \
  --query 'Role.Arn' \
  --output text) || {
    echo "Role might already exist, getting ARN..."
    ROLE_ARN=$(aws iam get-role --profile ${AWS_PROFILE} --role-name ${ROLE_NAME} --query 'Role.Arn' --output text)
  }

# 4. Create Permissions Policy
echo "🔐 Creating permissions policy..."
cat > permissions-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "apigateway:*",
        "s3:*",
        "logs:*",
        "execute-api:*",
        "cloudfront:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion",
        "iam:ListPolicyVersions",
        "iam:CreateServiceLinkedRole",
        "iam:GetInstanceProfile",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile"
      ],
      "Resource": "*"
    }
  ]
}
EOF

# 5. Attach Policy to Role
echo "📎 Attaching policy to role..."
aws iam put-role-policy \
  --profile ${AWS_PROFILE} \
  --role-name ${ROLE_NAME} \
  --policy-name ${POLICY_NAME} \
  --policy-document file://permissions-policy.json

# Cleanup temp files
rm -f trust-policy.json permissions-policy.json

echo ""
echo "✅ Setup complete!"
echo ""
echo "🔑 Add this to your GitHub Repository Secrets:"
echo "AWS_ROLE_ARN = ${ROLE_ARN}"
echo ""
echo "📝 Add these to your GitHub Repository Variables:"
echo "AWS_REGION = ${AWS_REGION}"
echo ""
echo "⚠️  Frontend URLs will be available after CloudFront deployment:"
echo "After deploying frontend infrastructure, get CloudFront URLs with:"
echo "# For dev environment:"
echo "DEV_FRONTEND_URL=\$(aws cloudformation describe-stacks --stack-name demo-blue-frontend-dev --query 'Stacks[0].Outputs[?OutputKey==\`FrontendUrl\`].OutputValue' --output text --region ${AWS_REGION})"
echo "# For prod environment:"
echo "PROD_FRONTEND_URL=\$(aws cloudformation describe-stacks --stack-name demo-blue-frontend-prod --query 'Stacks[0].Outputs[?OutputKey==\`FrontendUrl\`].OutputValue' --output text --region ${AWS_REGION})"
echo ""
echo "⚠️  Backend URLs will be available after lambda deployment:"
echo "DEV_BACKEND_URL = https://{api-id}.execute-api.${AWS_REGION}.amazonaws.com/dev"
echo "PROD_BACKEND_URL = https://{api-id}.execute-api.${AWS_REGION}.amazonaws.com/prod"
echo ""
echo "📦 Next steps:"
echo "1. Deploy frontend infrastructure: cd apps/bank-web-app && sam deploy --config-env dev"
echo "2. Deploy lambda infrastructure: cd apps/bank-api && sam deploy --config-env dev"
echo "3. Get CloudFront URLs from frontend deployment outputs"
echo "4. Get API Gateway URLs from lambda deployment outputs"
echo "5. Update GitHub variables with actual URLs:"
echo "   - DEV_FRONTEND_URL (CloudFront distribution URL)"
echo "   - PROD_FRONTEND_URL (CloudFront distribution URL)"
echo "   - DEV_BACKEND_URL (API Gateway URL)" 
echo "   - PROD_BACKEND_URL (API Gateway URL)"
echo ""
echo "🎯 Your CI/CD pipeline is now ready to run!" 
