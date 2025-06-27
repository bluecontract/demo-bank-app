# Technical Design – Initial High-Level Architecture

_Status: Initial draft – subject to refinement during Architecture & Implementation phases_

## 1. Overview Diagram (textual)

```
          ┌────────────┐        HTTPS         ┌──────────┐
User ───► │  React UI  │ ────────────────────►│ API GW   │
          │  (S3 SPA)  │                      │ (REST)   │
          └────────────┘                      └────┬─────┘
                                                   │ Lambda Integrations
                                                  ▼
                                            ┌───────────┐
                                            │  Bank     │
                                            │  Lambda   │
                                            └────┬──────┘
                                                 │ DynamoDB (single table)
                                                 ▼
                                            ┌───────────┐
                                            │ Accounts  │
                                            └───────────┘

Webhook & MyOS interaction (simplified):
```

MyOS Mock ──HTTP──► API GW `/blue/webhooks` ──► Bank Lambda (monolith) ──► DynamoDB
Bank Lambda (monolith) ──HTTPS──► MyOS Mock `/agents/...`

```
The monolithic **Bank Lambda** handles authentication (name-only sign-in with JWT cookie), funding, transfers, transaction history, incoming webhooks, **and** outgoing requests to MyOS. This design consciously forgoes at-least-once delivery guarantees to keep the architecture minimal and simple. Further breakdown and advancements possible at later stage.

## 2. Component Descriptions
| Component | Responsibility |
|-----------|----------------|
| **React UI (S3)** | Static SPA hosted on S3 (CloudFront optional) for registration, funding, transfers, history, upload Blue doc. |
| **API Gateway (REST)** | Single entrypoint; routes to Bank Lambda. |
| **Bank Lambda (monolith)** | Auth (name → JWT cookie), funding, transfers, transaction history, webhook processing, direct MyOS calls. |
| **DynamoDB (Single Table)** | PK = `ACCOUNT#<accountNumber> / `TXN#<id>`; GSI on `userId` for "my accounts" queries; supports idempotent writes if needed. |
| **MyOS Mock Service** | External mock providing `/agents` endpoints and webhook callbacks. |

## 3. Data Model (initial)
* **Account** – `accountNumber (PK)`, `userId (GSI1PK)`, `balance`, `createdAt`.
* **Transaction** – `txnId (PK)`, `accountNumber`, `type`, `amount`, `status`, `reference`, `createdAt`.

## 4. Security Considerations
* Access token: 1-hour JWT in `HttpOnly; Secure; SameSite=Strict` cookie signed by Bank Lambda.
* Webhooks secured via HMAC header (shared secret).
* Secrets stored in AWS SSM Parameter Store (encrypted) – simulated via LocalStack in local dev.


*Sort-Key (SK) considerations*: refine DynamoDB single-table design to include composite SKs (e.g., `TXN#<id>` for transactions, `EVENT#<id>` for idempotency) to support efficient queries.
```
