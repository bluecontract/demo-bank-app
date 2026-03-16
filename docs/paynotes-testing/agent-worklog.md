# Agent worklog

## Context

- branch: `cursor/suita-testowa-paynote-f41a`
- runner: Cursor Cloud
- event source mode: `pull-and-post`
- run id: pending

## Iteration 0 — discovery

### Scope

Verify that the full repository, the supplied PayNote package, and the local
tooling are sufficient to start implementation without changing production bank
logic.

### Discovery sources reviewed

- `libs/shared/bank-api-contract/src/lib/bank-api-contract.ts`
- `apps/bank-api/src/main.integration.test.ts`
- `apps/bank-api/src/paynote/webhook.ts`
- `libs/paynotes/src/infrastructure/httpMyOsGateway.ts`
- `apps/bank-api/src/contracts/payNoteSummaryMock.ts`
- `apps/bank-api/src/shared/openAiSecrets.ts`
- `libs/banking/src/infrastructure/CardIssuingConfiguration.ts`
- `apps/bank-api/env.local.example.json`
- `apps/bank-api/env.local.json`
- `apps/bank-api/project.json`
- `package.json`
- `test-coverage-package/**/*`

### Commands run

- `ls`
- `git status --short --branch`
- `node -v && npm -v && python3 --version`
- `docker info > /dev/null && echo docker:ok || echo docker:fail`
- `sam --version && samlocal --version`
- `bash apps/localstack/scripts/status-localstack.sh`

### Results

- The full repository is present at the workspace root.
- The PayNote blueprint package is present under `test-coverage-package/` and
  has not been overlaid into the repository root.
- The bank contract and handlers confirm:
  - `POST /v1/paynotes/webhook` exists
  - the bank accepts both full webhook payloads and `{ "id": eventId }`
  - `fetchEvent` fallback is already implemented
- The MyOS gateway confirms the required HTTP surface:
  - `GET /myos-events/:eventId`
  - `GET /documents/:sessionId`
  - `POST /documents/bootstrap`
  - `POST /documents/:sessionId/:operation`
- `LLM_SUMMARY_DISABLED` is supported and can avoid real OpenAI for the main
  suite.
- The default card processor token is `demo-bank-processor-token`.
- Tooling is available:
  - Node.js
  - npm
  - Docker
  - SAM CLI
  - samlocal
- `.localstack.env` exists, but LocalStack was not running during discovery.
- `.env.agent` exists but still contains placeholder values; the required real
  values were provided separately by the user.
- Package docs contain one inconsistency: one document still recommends delivery
  by `eventId`, while the current prompt and the rest of the package expect full
  payload forwarding. The suite will follow the explicit task prompt:
  full payload for the main path, `{ "id": eventId }` only for a compatibility
  smoke test.

### Next

- Add initial `docs/paynotes-testing/*` scaffolding in English.
- Add dedicated PayNote test targets and supporting env normalization.
- Introduce the reusable helper layer before adding scenario coverage.
