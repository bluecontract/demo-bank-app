# Requirements Specification – Blue Demo Bank

Initial high-level requirements – to be refined per workflow.

## Date
2025-06-26

## Functional Requirements

### FR-1 Simplified Authentication
1.1 Visitor provides a unique **Name** to create (or reuse) a profile.  
1.2 On sign-in, system issues a short-lived JWT containing `userId` and `name`.  
1.3 Subsequent API requests must include a valid session token; missing or invalid tokens result in `401 Unauthorized`.

### FR-2 Bank Account Management
2.1 A signed-in user can create one or more **bank accounts** (each receives a unique account number).  
2.2 System shows the current balance for the each bank account.

### FR-3 Funding
3.1 Via an in-app UI form, a user can top-up a selected bank account with any positive amount.  
3.2 Funding appears as an _incoming_ transaction and updates the account balance.

### FR-4 Standard Transfers
4.1 A user can initiate a transfer by either:  
 a. Selecting a recipient from a predefined list (demo convenience), or  
 b. Entering an arbitrary account number.  
4.2 If the target account number does **not** exist within the bank, the transfer fails with a clear error message.  
4.3 Upon success or failure, the user sees a confirmation screen, and successful transfers are recorded in history.

### FR-5 Transaction History
5.1 User can view paginated history for a given bank account.  
5.2 Entries include human-readable date, amount, type, counter-party, and status.

### FR-6 Blue-Enabled Transfers (Phase 2)
6.1 User uploads a Base64 Blue document.  
6.2 System generates a natural-language summary via LLM and shows it to the user.  
6.3 Upon confirmation, system creates an agent in MyOS (mock) with the document.  
6.4 System listens to `/blue/webhooks` for new document versions & events.  
6.5 On `BlockFunds`, `PushOutPayment`, `CancelPayment`, system updates ledger and responds via `POST /agents/{id}/{operation}`.

## UX Design

UX design should follow example demo app from presentation.
Screenshots of the views are gathered under [(./001-ux-assets)](./001-ux-assets/)

## Non-Functional Requirements

> **Note** – Non-functional requirements are **not critical** for the demo's success but are documented to illustrate the decision-making process and to provide a baseline for future hardening.

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Availability | ≥ 99.5 % during demo period (single-region deployment) |
| NFR-2 | Scalability | Design for 100 k users / 1 M events without re-architecture |
| NFR-3 | Security | IAM least-privilege, parameterised secrets, OWASP top-10 mitigated |
| NFR-4 | Cost | Idle cost ≤ USD 10/month in dev account |
| NFR-5 | Observability | Structured JSON logs, error tracking, basic metrics (p95 latency, error rate) |
| NFR-6 | CI/CD | Automated lint, test, deploy on main branch push |
| NFR-7 | Testing | ≥ 80 % statement coverage, integration tests, e2e tests for critical flows |
| NFR-8 | Security | Session token delivered via `HttpOnly; Secure; SameSite=Strict` cookie and validated on every request |

## Out-of-Scope
* Internationalisation & multi-currency support.  
* KYC/AML processes.  
* Real payment processor integration (Stripe, SEPA, etc.).

## Assumptions
* MyOS endpoints are implemented as mock.  
* Blue Labs will provide sample documents for Phase 2.  
* Exact timeout for stalled smart transfers will be defined during development.
