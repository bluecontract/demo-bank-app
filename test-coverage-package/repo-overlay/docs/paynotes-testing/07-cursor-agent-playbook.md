# Cursor agent playbook

## Obowiązkowe artefakty pracy

Agent ma utrzymywać:

- `docs/paynotes-testing/agent-worklog.md`
- `docs/paynotes-testing/bug-register.md`

## Minimalny rytm pracy

Każda iteracja:

1. ma jasno określony mały zakres,
2. kończy się uruchomieniem `format:check` + lintera + typechecka + targeted tests,
3. kończy się wpisem do workloga,
4. kończy się małym commitem.

## Discovery sources, które agent ma przeczytać na starcie

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

## Komendy przed commitem

Agent ma potwierdzić realne komendy repo, a następnie stale uruchamiać:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- najwęższy sensowny zestaw testów dla aktualnej zmiany

## Komendy obowiązkowe przed finalnym zamknięciem zadania

Na końcu agent ma wykonać i zapisać wynik:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:all`
- nowe / zmienione suite’y PayNote
- `npm run security:audit:dev`

Jeśli któraś komenda nie może zostać uruchomiona z powodu ograniczeń runnera / sieci / środowiska, agent ma to jawnie opisać w worklogu razem z przyczyną.

## Jeśli coś nie przechodzi

- nie maskuj problemu,
- nie przełączaj logiki biznesowej banku, żeby test przeszedł,
- odnotuj symptom, reprodukcję, root cause i dowody,
- jeśli trzeba, zostaw failing / skipped test wraz z dokumentacją blokera.
