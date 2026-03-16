# Jak użyć tej paczki

1. Rozpakuj paczkę obok repo albo w osobnym katalogu roboczym.
2. Skopiuj zawartość `repo-overlay/` do korzenia repo.
3. Nie nadpisuj w ciemno istniejących plików biznesowych. W tej paczce nie ma patchy logiki banku.
4. W repo utwórz plik `.env.agent` na bazie `apps/bank-api/tests/paynotes/.env.agent.example`.
5. Do `.env.agent` wpisz:
   - `MYOS_BASE_URL`
   - `MYOS_API_KEY`
   - `MYOS_ACCOUNT_ID`
6. Daj agentowi pliki z tej paczki oraz `PROMPT_FOR_CURSOR.md`.
7. Uzupełnij pozostałe env zgodnie z `repo-overlay/docs/paynotes-testing/03-e2e-suite-requirements.md` oraz `SECRETS_HANDOFF_CHECKLIST.md`.
8. Domyślnie wybierz tryb `pull-and-post` oparty o **MyOS event polling + forward pełnego payloadu**.
9. `sqs-poller` traktuj jako fallback, a `direct-webhook` jako ostatnią opcję.

## Ważne

- repo bazowe jest pełnym codebase'em; agent ma użyć konkretnych plików repo do discovery, przede wszystkim:
  - `libs/shared/bank-api-contract/src/lib/bank-api-contract.ts`,
  - `apps/bank-api/src/main.integration.test.ts`,
  - `apps/bank-api/src/paynote/webhook.ts`,
  - `libs/paynotes/src/infrastructure/httpMyOsGateway.ts`,
  - `apps/bank-api/src/contracts/payNoteSummaryMock.ts`,
  - `libs/banking/src/infrastructure/CardIssuingConfiguration.ts`,
  - `apps/bank-api/env.local.example.json` i `apps/bank-api/env.local.json`.
- `apps/bank-api/project.paynotes-targets.snippet.json` jest **snippetem** do scalenia z istniejącym `project.json`.
- helpery i scenariusze są blueprintem, ale powinny być dopięte do realnych endpointów i targetów z repo.
- jeśli MyOS read API działa stabilnie, **nie zarządzaj webhookami MyOS** w testach.
- jeśli potrzebujesz stricte zweryfikować bankowy fallback fetch-on-id, użyj dołączonego smoke testu `{ id: eventId }`; nie rób z tego głównego mechanizmu live suite.
- jeżeli bootstrap lokalnego systemu wymaga obecności sekretu OpenAI, seeded placeholder jest poprawnym rozwiązaniem; realny OpenAI key nie jest wymagany dla głównej suite.
