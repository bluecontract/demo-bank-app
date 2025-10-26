# Documentation Overview

This directory houses the design notes, ADRs, API references, and product requirements for the demo bank.

## Current Highlights

- `GET /v1/activity/{accountNumber}` is the single merged feed for account timelines. It returns posted transactions alongside hold lifecycle events in timestamp order. The retired `/v1/accounts/{accountId}/transactions` list no longer exists in contracts or handlers.
- API contracts are generated under `docs/api/` via `npm run generate-docs` and reflect the latest activity schema.
- Requirements in `requirements/003-core-banking.md` and hold design notes track the migration milestones for the activity feed.

Refer to the subdirectories for deeper details:

- `api/` – generated OpenAPI definitions.
- `design/` – detailed feature and architecture docs (e.g. holds lifecycle).
- `requirements/` – product requirements by theme.
- `adr/` – architectural decision records.
- `problem-exploration/` – research notes and framing.
