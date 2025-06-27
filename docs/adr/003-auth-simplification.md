# 003 Authentication Simplification – Name-Only Signup

## Status
- 2025-06-26 Accepted Relates-to ADR 001

## Context
Previous ADR 001 assumed either Cognito or a custom email/password flow handled by the Bank Lambda.  Authentication, however, is **not a core demo scenario**; maintaining even a light credential workflow adds UX and code overhead.

Moreover, AWS Cognito User Pools are not supported in Localstack free version which introduces DX challenges

We need the minimum viable mechanism that isolates user data while keeping the rest of the system unchanged. This feature could be extended in the later iterations.

## Decision
1. **Name-Only Sign-Up & Sign-In**  
   • Sign-up screen asks for a display **Name** – no email, password, MFA, or recovery.  
   • "Sign in as <Name>" simply issues a token for an existing name or creates one on-the-fly.
2. **JWT Generation & Delivery**  
   • Bank Lambda signs a **1-hour** JWT containing `sub` (userId) and `name`.  
   • Token is delivered as `Set-Cookie: demoAuth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/`.  
   • Browser automatically sends cookie on subsequent API calls; SPA code never reads it.
3. **Inline Verification (no Authorizer Lambda)**  
   • API Gateway **Lambda proxy** integration passes requests directly to Bank Lambda; token verification happens at the beginning of the handler.  
   • Separate Authorizer Lambda is dropped to avoid additional resources.

*Alternatives considered*
- **Keep Authorizer Lambda** – adds clean separation but one more deployment unit; deemed unnecessary for demo.
- **Basic Auth header** – simpler but fails to demonstrate JWT patterns useful for real integrations.
- **Anonymous demo user** – breaks multi-user flows like transfers.

## Consequences
* **Pros**: Fast onboarding, less code, still exercises JWT handling & per-user data access; no dependency on Cognito or password storage.  
* **Cons**: Minimal security; no refresh token, no revocation list, replay feasible during 1-hour TTL.  
  *How to harden later*: add refresh token & revocation list, consider explicit CSRF tokens if SameSite mode ever needs to be relaxed, and evaluate shorter TTL + silent token refresh. Out of scope: DPoP, mTLS.

## Supersedes
Partially supersedes ADR 001 item *Authentication* by replacing email/password or Cognito flow with name-only JWT login. 
