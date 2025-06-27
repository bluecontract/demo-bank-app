# 001 High-Level Technical Decisions

## Status:
  - 26-06-2025 Accepted

## Context
The demo must balance quick delivery (interview timeline) with showcasing best-practice engineering for Blue Labs and potential customers.  Cloud resources should be easy to spin up, inexpensive at rest, and familiar to the team's AWS-centric stack.

## Decision
1. **Serverless First** – Use AWS Lambda + API Gateway for compute; scale-to-zero keeps cost minimal.
2. **AWS SAM** – Adopt AWS Serverless Application Model for IaC & deployment; integrates with CI/CD and remains lighter than full CDK for a demo.
3. **DynamoDB** – Single-table design for accounts, transactions, and idempotency keys; avoids setup and operational burden of RDBMS.
4. **Single monlithic Lambda** – A single monolithic Lambda handles `/blue/webhooks`, ledger updates, and direct MyOS calls. Separate webhook lambda or async event internal communication via EventBridge/SQS is omitted to keep the demo minimal, accepting potential at-least-once delivery gaps.
5. **TypeScript / Node.js** – Aligns with role expectations and smoothens fullstack experience.
6. **SPA Hosting (S3)** – Host the React SPA from an S3 static website bucket; optionally fronted by CloudFront for CDN and HTTPS.
7. **MyOS Integration Mock** – Provide a flexible mock: either a dedicated Lambda behind API Gateway **or** an open-source mock service capable of both `/agents` endpoints and webhook callbacks.

## Consequences
* **Pros**: Low cost, rapid iteration, infra-as-code, observable, demonstrable modern patterns.
* **Cons**: Cold-start latency; DynamoDB single-table modelling adds cognitive load; SAM less expressive than CDK. Lack of at least once guarantees due to simplification (not an issue for demo).
* **Follow-ups**: Evaluate CDK if design grows; document single-table patterns for reviewers.
