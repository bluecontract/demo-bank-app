# Requirements Specification – Simplified Authentication

## Date

2025-07-01

## Functional Requirements

| ID        | Requirement                                                                                                                                                                                     | Priority |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-AUTH-1 | **Sign-Up** – A visitor can create an account by entering a _Name_ that is not already taken.                                                                                                   | Must     |
| FR-AUTH-2 | If the chosen Name already exists, the sign-up attempt fails with a clear error message instructing the visitor to use Sign-In instead.                                                         | Must     |
| FR-AUTH-3 | **Sign-In** – A visitor can log in by entering an existing Name; upon success the system issues a session token and redirects to the main app.                                                  | Must     |
| FR-AUTH-4 | When a visitor enters a Name that does not exist during Sign-In, the system displays a clear, human-readable error optimised for UX.                                                            | Should   |
| FR-AUTH-5 | **Sign-Out** – A signed-in user can explicitly log out from the SPA which clears the session token and returns to the landing page.                                                             | Must     |
| FR-AUTH-6 | **Session Handling** – All subsequent API requests must include a valid session token; missing or invalid tokens return **401 Unauthorized** and the SPA redirects to Sign-In.                  | Must     |
| FR-AUTH-7 | **Token Expiry** – Session tokens expire after 1 hour; on expiry the next API call returns 401, the SPA redirects to Sign-In, and a notification informs the user that the session has expired. | Must     |
| FR-AUTH-8 | **Concurrent Sessions** – The same user may be signed in from multiple devices/tabs simultaneously; no explicit limit is enforced.                                                              | Could    |
| FR-AUTH-9 | System must operate identically in local development (LocalStack/SAM) and in deployed AWS environments, including within automated e2e tests.                                                   | Must     |

## Non-Functional Requirements

| ID         | Category      | Requirement                                                                                                                                                                                                  |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-AUTH-1 | Security      | Session is delivered as an `HttpOnly; Secure; SameSite=None` cookie so it is sent with cross-site requests from the CloudFront SPA to the API Gateway endpoint; token contains only `sub` and `name` claims. |
| NFR-AUTH-2 | Security      | Tokens are cryptographically signed and verified on every request.                                                                                                                                           |
| NFR-AUTH-3 | Performance   | Auth endpoints respond within p95 ≤ 1 s under 50 RPS.                                                                                                                                                        |
| NFR-AUTH-4 | Availability  | Auth endpoints should be available ≥ 99.5 %.                                                                                                                                                                 |
| NFR-AUTH-5 | Observability | Successful and failed auth attempts are logged using structured JSON (no PII beyond Name).                                                                                                                   |
| NFR-AUTH-6 | Extensibility | Design should permit adding token refresh & revocation without breaking callers.                                                                                                                             |
| NFR-AUTH-7 | Cost          | Authentication must not noticeably raise the system's idle AWS cost.                                                                                                                                         |
| NFR-AUTH-8 | Testing       | Automated tests run with dedicated test user Names that cannot clash with real users, ensuring isolation.                                                                                                    |

## Acceptance Criteria

- Visitor can successfully sign up with a new Name and immediately access banking features.
- Duplicate Name sign-up displays an error and does **not** create a second user record.
- Visitor can sign in with an existing Name and obtain a valid session cookie.
- Explicit Log-out clears the cookie and redirects to landing page; subsequent protected API call returns 401.
- After 1 hour simulated expiry, protected call returns 401 and SPA redirects to Sign-In.
- e2e Playwright tests cover happy path (sign-up → sign-out → sign-in) and error path (duplicate sign-up, unknown sign-in).

### Note on SameSite Change

ADR 003 originally specified `SameSite=Strict`. Because the SPA is served from CloudFront and the API from API Gateway (different domains), that setting would prevent the browser from sending the cookie. We therefore relax the attribute to `SameSite=None; Secure` for functional correctness. This introduces a CSRF vector; hardening options (custom domain, CSRF token, double-submit) are deferred and must be reconsidered if the demo evolves beyond its current scope. A follow-up ADR will supersede the relevant part of ADR 003.
