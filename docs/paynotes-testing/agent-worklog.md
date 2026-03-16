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

---

## Iteration 1 — env loading and target scaffolding

### Scope

Add the first PayNote-specific repository scaffolding inside `apps/bank-api`
without touching runtime bank logic:

- environment examples
- `.env.agent` normalization helpers
- dedicated Vitest configs
- dedicated Nx targets
- test-directory README
- TypeScript project wiring for PayNote tests

### Changes

- Added `apps/bank-api/tests/paynotes/README.md`.
- Added PayNote example env files:
  - `.env.agent.example`
  - `.env.paynotes.fast.example`
  - `.env.paynotes.live.example`
- Added repository-root `.env.agent` loading and env alias normalization for
  E2E/canary tests in `tests/paynotes/lib/agentEnv.ts`.
- Added a setup file to load and normalize agent env before E2E tests.
- Added dedicated Vitest config files for:
  - fast/live integration
  - serial integration
  - real MyOS E2E canaries
- Added `tsconfig.paynotes.json` and referenced it from the app TypeScript
  project so PayNote tests/config are typechecked with the app.
- Added dedicated Nx targets in `apps/bank-api/project.json`:
  - `test:paynotes:integration`
  - `test:paynotes:integration:serial`
  - `test:paynotes:e2e`
  - `test:paynotes:all`

### Commands run

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration`

### Results

- Formatting, linting, and typechecking passed after the new scaffold landed.
- The dedicated PayNote integration target is now wired and runs successfully.
- The target currently reports `No test files found`, which is expected because
  scenario implementations have not been added yet.
- The target also confirmed that LocalStack can now be started through the Nx
  dependency chain for PayNote-focused runs.

### Bugs / blockers discovered

- `npm run format:check` initially failed because the staged code-review
  artifacts were not Prettier-formatted. The artifacts were formatted and the
  command then passed. This is not a product/runtime blocker.

### Next

- Build the reusable helper layer for local live scenarios.
- Implement the first fast scenarios and align them to the real contract.

---

## Iteration 2 — helper layer and fast scenarios

### Scope

Introduce the reusable helper layer for local live PayNote scenarios and land
the first fast scenarios with real runtime evidence.

### Changes

- Added reusable local live helpers under `apps/bank-api/tests/paynotes/live/`:
  - bank invocation helper
  - bank test driver
  - LocalStack-backed test context
  - deterministic MyOS HTTP harness
  - amount, wait, assertion, setup, and reporting helpers
  - PayNote document / webhook payload builders
- Added active fast integration scenarios:
  - `transfer-reserve-capture.integration.test.ts`
  - `fetch-by-id-fallback.smoke.integration.test.ts`
  - `idempotency-and-ordering.integration.test.ts`
- Added an implemented-but-skipped scenario for:
  - `card-delivery-capture.integration.test.ts`
- Documented the blocker in `bug-register.md`.

### Commands run

- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration`
- targeted single-file reruns for the card delivery scenario while debugging

### Results

- Active fast scenarios now run successfully through the dedicated PayNote
  target:
  - transfer reserve → capture
  - webhook `{ id }` fallback smoke
  - duplicate-event idempotency on the transfer flow
- The helper layer now creates isolated Dynamo tables and secrets per test file,
  uses the in-process bank handler against LocalStack-backed repositories, and
  exposes a deterministic MyOS harness for runtime evidence.
- The card delivery happy path remains blocked in local harness mode and has
  been converted into a skipped scenario with a detailed bug-register entry.

### Bugs / blockers discovered

- `BUG-001` — card delivery acceptance requires a richer follow-up MyOS
  bootstrap continuation than the current local harness replay provides.

### Next

- Add the remaining planned PayNote scenarios or explicit skipped blockers.
- Add the serial/complex and real-MyOS canary scaffolding required by the plan.

---

## Iteration 3 — skipped serial/E2E coverage and operational docs

### Scope

Complete the next layer of repository scaffolding so the remaining planned
scenarios and canaries exist explicitly in the repo even when they are not yet
runnable.

### Changes

- Added skipped scenario files for:
  - `pending-install-capture`
  - `milestones.partial-captures`
  - `subscription.mandate-cycle`
  - `voucher.monitoring`
- Added real-MyOS canary scaffolding:
  - `tests/paynotes/e2e/paynotes.canary.e2e.test.ts`
  - `tests/paynotes/e2e/README.md`
  - `tests/paynotes/e2e/webhook-delivery-modes.md`
  - `tests/paynotes/e2e/lib/WebhookQueuePoller.ts`
- Added reusable live/E2E helper scaffolding for:
  - MyOS live HTTP access
  - explicit event pumping / pull-and-post synchronization
- Added the remaining English PayNote docs covering:
  - scenario catalog
  - E2E requirements
  - blocker classes
  - extension policy
  - runner decision rules
  - webhook strategy
  - event sync design
  - MyOS event polling
  - `LLM_SUMMARY_DISABLED` fixture rules

### Commands run

- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration:serial`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:e2e`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

### Results

- Active fast PayNote scenarios still pass.
- Serial PayNote target now exists and passes with explicit skipped scenarios.
- E2E PayNote canary target now exists and passes with explicit skipped canary
  tests unless `MYOS_E2E_ENABLED=1` is provided.
- The docs now cover the required suite split, scenarios, event sync, E2E
  requirements, extension policy, reporting, and blocker classes.

### Bugs / blockers discovered

- `BUG-002` — pending-action continuation is not yet reproduced locally.
- `BUG-003` — richer serial continuation chains (milestones, mandate, voucher)
  are not yet modeled in the local harness.

### Next

- Continue narrowing the blocked flows where feasible.
- Prepare the next verification pass and commit the current scaffolding.

---

## Iteration 4 — final verification pass

### Scope

Run the required repository verification commands against the current PayNote
suite state and capture the result explicitly.

### Commands run

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:all`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:integration:serial`
- `npx nx run @demo-bank-app/bank-api:test:paynotes:e2e`
- `npm run security:audit:dev`

### Results

- `format:check` — passed
- `lint` — passed (with warnings in new PayNote test helpers; no lint errors)
- `typecheck` — passed
- `test:all` — passed
- `test:paynotes:integration` — passed
- `test:paynotes:integration:serial` — passed with explicit skipped scenarios
- `test:paynotes:e2e` — passed with explicit skipped canaries unless
  `MYOS_E2E_ENABLED=1`
- `security:audit:dev` — failed due pre-existing dependency vulnerabilities in
  third-party packages (`jsdom` transitive `@tootallnate/once`, `verdaccio`
  transitive `ajv`, `flatted`, `svgo`)

### Bugs / blockers discovered

- The PayNote scenario blockers remain `BUG-001` through `BUG-003`.
- The security audit failure appears unrelated to the PayNote test-suite changes
  and is caused by existing dependency vulnerabilities in the repo.

### Next

- No further implementation is required for the current plan beyond the
  documented blockers and final commit/push hygiene.

---

## Iteration 5 — BUG-001 closure and blocker narrowing

### Scope

- close `BUG-001` with a verified fix
- verify the remaining PayNote targets
- replace generic blocker text for `BUG-002` / `BUG-003` with precise,
  evidence-backed root cause notes

### Commands run

- `npx nx run @demo-bank-app/bank-api:typecheck`
- `npx nx run @demo-bank-app/bank-api:lint`
- `set -a; . ./.localstack.env; set +a; npx nx run @demo-bank-app/bank-api:test:paynotes:integration`
- `set -a; . ./.localstack.env; set +a; npx nx run @demo-bank-app/bank-api:test:paynotes:integration:serial`
- `set -a; test -f apps/bank-api/tests/paynotes/.env.agent && . apps/bank-api/tests/paynotes/.env.agent; set +a; npx nx run @demo-bank-app/bank-api:test:paynotes:e2e`
- targeted diagnostic runs for `pending-install-capture.integration.test.ts`

### Results

- `card-delivery-capture` now passes locally end to end.
- `test:paynotes:integration` passes with the delivery/capture scenario active.
- `test:paynotes:integration:serial` passes with 3 explicit skips.
- `test:paynotes:e2e` passes with 4 explicit skips.
- `BUG-002` was narrowed to a specific customer-read-model + hold-mapping gap.
- `BUG-003` was narrowed to a specific stateful continuation gap in the local
  MyOS harness.

### Bugs / blockers discovered

- `BUG-001` is closed.
- `BUG-002` remains open, but the generic “pending-action continuation” wording
  has been replaced with exact runtime evidence:
  - raw contract exists with a pending action
  - customer route returns `Contract summary not available`
  - direct pending-action decision still leaves capture without a hold mapping
- `BUG-003` remains open, but the blocker is now explicit:
  the current `MyOsHarness` does not synthesize the multi-epoch follow-up
  events required by milestone, subscription, and voucher documents.
