# Cursor agent playbook

## Required artifacts

Keep these files up to date:

- `docs/paynotes-testing/agent-worklog.md`
- `docs/paynotes-testing/bug-register.md`

## Minimum working rhythm

Each iteration should:

1. have a small, explicit scope
2. end with `format:check`, lint, typecheck, and the narrowest meaningful test
   run
3. update the worklog
4. end with a small commit

## Discovery sources

Start with:

- `libs/shared/bank-api-contract/src/lib/bank-api-contract.ts`
- `apps/bank-api/src/main.integration.test.ts`
- `apps/bank-api/src/paynote/webhook.ts`
- `libs/paynotes/src/infrastructure/httpMyOsGateway.ts`
- `apps/bank-api/src/contracts/payNoteSummaryMock.ts`
- `libs/banking/src/infrastructure/CardIssuingConfiguration.ts`
- `package.json`
- `apps/bank-api/project.json`
- `docs/paynotes-testing/11-myos-event-polling-and-payloads.md`
- `docs/paynotes-testing/12-summary-disabled-fixture-requirements.md`

## Before each commit

Run and record:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- the narrowest meaningful PayNote test target
