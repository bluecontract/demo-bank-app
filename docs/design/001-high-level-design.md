# Technical Design – Initial High-Level Architecture

*Status: Initial draft – subject to refinement during Architecture & Implementation phases*

## 1. Overview Diagram (textual)
```
          ┌────────────┐        HTTPS         ┌──────────┐
User ───► │  React UI  │ ────────────────────►│ API GW   │
          │  (S3 SPA)  │                      │ (REST)   │
          └────────────┘                      └────┬─────┘
                                                   │ Lambda Integrations
        ┌──────────────────────┐                   ▼
        │  AWS Cognito         │◄─OIDC───┐  ┌──────────────┐
        │  (User Pool)         │         │  │ Auth Lambda  │
        └──────────────────────┘         │  └──────────────┘
                                         │
                                         ▼
                                   ┌───────────┐
                                   │  Bank     │
                                   │ Lambda(s) │
                                   └────┬──────┘
                                        │ DynamoDB (single table)
                                        ▼
                                   ┌───────────┐
                                   │ Accounts  │
                                   └───────────┘

Webhook & MyOS interaction (simplified):
```
MyOS Mock ──HTTP──► API GW `/blue/webhooks` ──► Bank Lambda (monolith) ──► DynamoDB
Bank Lambda (monolith) ──HTTP──► MyOS Mock
```
The monolithic **Bank Lambda** handles all business logic, transaction history, incoming webhooks, **and** outgoing requests to MyOS.  
This design consciously forgoes at-least-once delivery guarantees to keep the architecture minimal.

## 2. Component Descriptions
| Component | Responsibility |
|-----------|----------------|
| **React UI (S3)** | Static SPA hosted on S3 (CloudFront optional) for registration, funding, transfers, history, upload Blue doc. |
| **API Gateway (REST)** | Single entrypoint; validates JWT from Cognito, routes to Bank Lambda. |
| **Auth Lambda** | On-boarding & login helpers; signs Cognito tokens if needed. |
| **Bank Lambda (monolith)** | Handles funding, transfers, transaction history, incoming webhooks, and direct MyOS calls. |
| **DynamoDB (Single Table)** | PK = `ACCOUNT#<id>` / `TXN#<id>`; GSI for recipient lookups; supports idempotent writes. |
| **MyOS Mock Service** | External mock service providing `/agents` endpoints and webhook callbacks. |

## 3. Data Model (initial)
* **Account** – `accountId (PK)`, `balance`, `createdAt`, `userId`.
* **Transaction** – `txnId (PK)`, `accountId`, `type`, `amount`, `status`, `reference`, `createdAt`.

## 4. Security Considerations
* Cognito authorises API calls; IAM authorises Lambda → DynamoDB.
* Webhooks secured via HMAC header (shared secret).  
* Secrets stored in AWS SSM Parameter Store (encrypted).

## 5. Open Design Questions
* Monolithic Lambda chosen for simplicity; evaluate splitting if complexity grows.  
* Will LocalStack suffice for CI integration tests?  

*Sort-Key (SK) considerations*: refine DynamoDB single-table design to include composite SKs (e.g., `TXN#<id>` for transactions, `EVENT#<id>` for idempotency) to support efficient queries.
