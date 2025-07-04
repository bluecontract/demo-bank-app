# Problem Exploration – Simplified Authentication

## Date

2025-07-01

## Context

Blue Demo Bank currently has no real authentication. A minimal yet credible flow is required so demo evaluators can experience isolated, per-user data while keeping local development (LocalStack) and AWS deployment friction-free. Prior ADR 003 recommends a _name-only_ credential model; here we validate that business need and document boundaries before deeper technical design.

## Stakeholders & Personas

- **Demo Evaluator** – wants to quickly access the demo without e-mail verification or password creation while still seeing personalised accounts and history.
- **Demo Presenter (Developer)** – needs an auth flow that works both locally and in CI/e2e pipelines, with minimal setup.
- **Security-Minded Observer** – may review the demo and will look for at least basic session isolation and acknowledgment of real-world hardening gaps.

## Scope / Use-Case Scenarios

1. **Sign-Up** – When a visitor provides a _Name_, the system creates a unique user profile so they can start banking flows.
2. **Sign-In** – When an existing user returns and enters their _Name_, the system recognises them and grants access to their data.
3. **Concurrent Sessions** – Multiple logins (tabs or devices) are permitted; restricting concurrency is typical in production but out-of-scope for the demo.
4. **Sign-Out** – A user can explicitly log out from the SPA. Closing the tab/browser should implicitly end the session when the token expires.

## Constraints & Assumptions

- **Username vs Display Name**: For now the single _Name_ input serves both roles; future versions may let users choose distinct values.
- **Uniqueness**: The chosen _Name_ must be unique. If a user tries to sign **up** with a Name that already exists, the app should display a clear error and advise using the separate **Sign-In** flow instead of creating a duplicate.
- **Session Duration**: 1-hour session lifespan balances demo convenience and token leakage risk. Token refresh/revocation mechanisms are recognised concerns but postponed.
- **Local & CI Support**: Auth must function locally and within e2e tests.
- **No External IdP**: Cognito or third-party IdPs are excluded to keep infrastructure lean.
- **Security Caveats**: The demo omits production-grade safeguards like MFA, CSRF tokens, refresh workflows, or revocation lists; these are documented for future work.

## Out-of-Scope / Risks

- Password storage, account recovery, and KYC checks.
- Rate-limiting of excessive sign-in attempts (advanced fraud or anomaly detection is out-of-scope for this demo).
- Full auditing of auth events (basic logging only).

> **Next**: Upon approval, draft an ADR detailing the technical solution (JWT cookie, sign-out endpoint, etc.) consistent with this exploration.
