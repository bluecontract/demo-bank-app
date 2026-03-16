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
- `02-scenario-catalog.md` — active, blocked, and planned scenario inventory
- `03-e2e-suite-requirements.md` — real-MyOS canary requirements
- `04-known-gaps-and-blockers.md` — common blocker classes
- `05-extension-policy.md` — rules for extending the suite
- `06-runner-decision-matrix.md` — when to use local live vs real MyOS
- `07-cursor-agent-playbook.md` — working rhythm and discovery sources
- `08-reporting-templates.md` — reporting file conventions
- `09-webhook-strategy.md` — preferred event-delivery modes
- `10-event-sync-design.md` — explicit event-sync helper model
- `11-myos-event-polling-and-payloads.md` — event filtering, sorting, and
  payload download rules
- `12-summary-disabled-fixture-requirements.md` — deterministic summary fixture
  rules
