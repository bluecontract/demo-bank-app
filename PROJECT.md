# Project – Blue Demo Bank

## 1. Purpose of this Document

This document captures the essential background, goals, scope, and ongoing progress for the demo banking application that integrates **Blue Language** documents and the **MyOS** SaaS platform. It now also serves as the single source of truth to track which phase of the full-cycle workflow we are in.

---

## 2. Context & Business Drivers

- **Company**: Blue Labs – creators of _Blue Language_ (contract DSL) and _MyOS_ (document processing SaaS).
- **Role**: Staff Engineer (hands-on & architectural leadership).
- **Challenge Goal**: Deliver a minimal yet _state-of-the-art_ demo that proves:
  1. A conventional bank system can be modelled with Blue documents.
  2. Integration with MyOS requires only modest code changes.
  3. Smart, document-driven transfers (e.g. _PayNote_) are possible.
- **Audience**: Blue engineering leadership & potential customers (developers evaluating Blue).

---

## 3. Blue Language & MyOS – Key Concepts

| Topic              | Summary                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blue Document      | Self-contained JSON/YAML document that stores _facts_ and _deterministic rules_ controlling a workflow. Each participant processes the document independently and deterministically.     |
| Participants       | Named actors (e.g. **Bank**, **Payer**, **Payee**) referenced inside the document.                                                                                                       |
| Events             | Explicit signals produced while processing the rules (e.g. `PushOutPayment`, `CancelPayment`, `BlockFunds`).                                                                             |
| Timelines          | Signed append-only logs where each participant records its own events.                                                                                                                   |
| Processors         | Engines (MyOS cloud, CLI, on-device) that read documents + timelines and converge on the same state.                                                                                     |
| MyOS               | The managed Blue processor operated by Blue Labs; exposes REST endpoints: `/agents` (create), `POST /agents/{id}/${operation}`, and webhook callbacks.                                   |
| Document Lifecycle | Each processing cycle → _new version_ of the document **plus** _list of newly triggered events_ (cf. <https://language.blue/docs/contracts/introduction#document-processing-mechanics>). |

Relevant docs:

- Intro to Blue – <https://language.blue/docs/introduction>
- Blue ID – <https://language.blue/docs/language/blue-id>
- Bank transfer recipe – <https://language.blue/docs/payments/bank-transfer>
- Integration strategies – <https://language.blue/docs/integration/blue-endpoint#integration-strategy-options>

---

## 4. Functional Scope

### 4.1 Phase 1 – Demo Bank (No MyOS)

1. **Account Management**  
   • Create fake user account (email + password or Cognito).
2. **Access**  
   • Sign in / Sign out.
3. **Funding**  
   • User can top-up the account with any amount.  
   • Appears as **incoming** transaction; balance updated.
4. **History**  
   • Display transaction history for selected account.
5. **Transfers**  
   • Pre-defined list of recipients for each account (loaded from file).  
   • Initiate standard transfer.  
   • Show standard transfer confirmation.  
   • Transfers only work for accounts that exist (transfer to non-existing account will fail).
6. **UI/UX**  
   • Similar look-and-feel to video demo (<https://www.youtube.com/watch?v=SUE1dbh8AnI>).

### 4.2 Phase 2 – Integration with MyOS

1. **Document Intake**  
   • User uploads Base64-encoded Blue document.
2. **Natural-Language Preview**  
   • Bank sends prompt → LLM summarises document for user confirmation.  
   • Prompt = concat of Blue rules explanation (from <https://language.blue/prompt.md>), optional style, and raw document.
3. **Transfers**  
   • Initiate Blue-enabled transfer.  
   • Users cannot cancel Blue-enabled transfers after funds are blocked.  
   • If no `PushOutPayment` arrives within timeout → unblock funds & cancel transfer.
4. **Agent Creation**  
   • `POST /agents` with document.  
   • Capture `agentId` for further updates.
5. **Webhook Processing**  
   • Bank exposes `/blue/webhooks`.  
   • MyOS posts _new document version_ + _triggered events_.
6. **Event Handling**  
   • Bank scans event list (top→bottom) for:  
    ‑ `SetRecipientDetails`  
    ‑ `BlockFunds` (re-entrant)  
    ‑ `CancelPayment`  
    ‑ `PushOutPayment` (capture).  
   • Executes corresponding core-bank action, then updates document via specific agent endpoints (e.g. `POST /agents/{id}/capturePayment`).
7. **Document Updates**  
   • Each bank action posts a relevant operation to the agent; MyOS continues processing.

---

## 5. Non-Functional Targets

- **Architecture**: Modern, **serverless AWS** (Lambda, API Gateway, DynamoDB, SQS/EventBridge, S3, IAM).  
  Rationale: aligns with job description and showcases cost-efficient scalability.
- **Language**: TypeScript / Node.js.
- **Quality**: "test-first/no-QA" – full automated unit & integration tests, TDD mindset.
- **Security**: least-privilege IAM, input validation, secure secret handling.
- **Performance**: event-driven, idempotent handlers, designed for millions of users & billions of events.
- **Dev Ex**: clean code, SOLID, modular, DRY.
- **CI/CD**: GitHub Actions with AWS SAM.

---

## 6. High-Level Integration Flow

```
User → Bank UI → (LLM summary) ──► Confirm ➜ POST /agents (MyOS)
                                             │
                                  MyOS processes doc
                                             │
                           POST /blue/webhooks (doc+events)
                                             │
              Bank Lambda parses events & executes core actions
                                             │
           POST /agents/{id}/<operation> with updated doc
                                             │
                                  MyOS processes next cycle…
```

---

## 7. Pending Implementation Decisions

1. **Recipient list format & source** – JSON/CSV? _(decide during implementation)_
2. **Authentication** – custom email/pass vs AWS Cognito? _(leaning Cognito)_
3. **LLM provider & model** – Anthropic, o3, OpenAI? _(choose later)_
4. **Timeout policy** for stalled transfers – duration set in requirements refinement.
5. **Sample Blue documents** to be provided by Blue Labs before Phase 2.
6. **Event names** – canonical strings confirmed before Phase 2.

---

## 8. Assumptions & Risks

- **Confirmed** MyOS mock is acceptable.
- **Confirmed** no compliance requirements beyond generic security best practices.
- **Risk**: Event names & endpoints may change – minor refactor likely.
- **Risk**: LLM summarisation – mitigated via extensive acceptance tests.

---

## 9. Useful Resources

- Video demo – <https://www.youtube.com/watch?v=SUE1dbh8AnI>
- Blue docs – <https://language.blue/docs>
- Prompt template – <https://language.blue/prompt.md>
- Integration options – <https://language.blue/docs/integration/blue-endpoint#integration-strategy-options>

---

## 10. Phase Tracker

- **Current phase**: 1 – Problem Exploration (not started)
- **Upcoming**: Capture Problem-Exploration artifact → move to Requirements phase.

---

_Last updated: <!-- YYYY-MM-DD -->_
