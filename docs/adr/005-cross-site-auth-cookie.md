# 005 Cross-Site Authentication Cookie

## Status

- 2025-07-01 Accepted – Supersedes ADR 003 section on `SameSite` attribute

## Context

The initial authentication simplification (ADR 003) chose to deliver the 1-hour session token as an
`HttpOnly; Secure; SameSite=Strict` cookie. This setting relies on the SPA and the API sharing the
same site. Our deployment, however, serves the React SPA from CloudFront
(`https://<hash>.cloudfront.net`) while the Bank API is exposed via API Gateway
(`https://<hash>.execute-api.eu-west-1.amazonaws.com`). Because these origins differ in
**site** definition, browsers would withhold a `SameSite=Strict` cookie, breaking every authenticated
API call.

## Decision

We will continue to use a cookie, changing its attributes to:

```
Set-Cookie: demoAuth=<jwt>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=3600
```

Key points:

- **Cross-Site Compatible** – `SameSite=None` ensures the browser sends the cookie with HTTPS requests from the CloudFront SPA to the API Gateway domain.
- **HttpOnly** – JavaScript running in the SPA cannot read or modify the token, reducing XSS-based exfiltration risk compared to localStorage or in-memory header approaches.
- **Secure** – Cookie transmitted only over HTTPS.

## Consequences

- Demo works without additional domains or proxy layers.
- HttpOnly continues to protect against token theft via XSS.
  − `SameSite=None` re-introduces CSRF exposure. For the demo we accept this risk and document future mitigations: CSRF token, double-submit cookie, or hosting SPA & API under one site.

## Rejected Alternatives

1. **Bearer header** – Store JWT in memory / localStorage and attach as `Authorization` header. Removes cross-site cookie issue but token becomes accessible to JavaScript (XSS risk) and requires extra code to send on every request.
2. **Custom shared domain** – Serve the SPA under the API domain (e.g., `app.bank-demo.blue`) or proxy the API under CloudFront so both origins share the same site, allowing `SameSite=Strict`. Provides stronger CSRF protection but introduces extra DNS, CloudFront behaviour, and infrastructure setup not warranted for a time-boxed demo.
