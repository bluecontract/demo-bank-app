# PayNote testing

This directory contains the project and operational documentation for the
PayNote test suite.

## Current scope

The suite is being introduced incrementally with the following constraints:

- test code, fixtures, test helpers, config, and documentation may change
- production bank logic and PayNote production logic must not change in this
  track
- repository artifacts in this directory must stay in English

## Discovery snapshot

The repository already confirms the key runtime assumptions needed by the suite:

- bank webhook endpoint: `POST /v1/paynotes/webhook`
- main live/E2E event delivery mode: **pull-and-post with full webhook payload**
- compatibility smoke path: `POST /v1/paynotes/webhook` with `{ "id": eventId }`
- MyOS HTTP surface used by the bank:
  - `GET /myos-events/:eventId`
  - `GET /documents/:sessionId`
  - `POST /documents/bootstrap`
  - `POST /documents/:sessionId/:operation`
- summary mocking can avoid real OpenAI when fixtures use
  `LLM_SUMMARY_DISABLED: true`
- the default local card processor token remains
  `demo-bank-processor-token` unless explicitly overridden

## Working files

- `agent-worklog.md` — iterative delivery log for the agent
- `bug-register.md` — blockers, root causes, and evidence
- `01-strategy-and-split.md` — target suite layering and test split
