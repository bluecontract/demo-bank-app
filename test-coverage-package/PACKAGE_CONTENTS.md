# Package contents

Najważniejsze elementy:

- `repo-overlay/docs/paynotes-testing/*` – strategia, katalog scenariuszy, runner matrix, event delivery strategy, reporting templates i dokładne instrukcje MyOS event polling.
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/*` – helpery setup/assert/wait/reporting oraz thin clienty MyOS.
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/EventPump.ts` – jawny helper synchronizacji eventów MyOS z wewnętrznym pollingiem i quiet period.
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/MyOsLiveClient.ts` – blueprint klienta MyOS z pollingiem wyłącznie dla `DOCUMENT_CREATED` / `DOCUMENT_EPOCH_ADVANCED`.
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/MyOsHarness.ts` – lokalny partner integracyjny z rejestrem bootstrapów, operacji oraz fetchy event/document do smoke testów `{ id: eventId }`.
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/localstackSecrets.ts` – helper seedingu sekretów, w tym poprawny placeholder OpenAI (`openAiApiKey`).
- `repo-overlay/apps/bank-api/tests/paynotes/live/lib/BankTestDriver.ts` – czytelne API testowe z helperami funded account / funded account + card / webhook delivery.
- `repo-overlay/apps/bank-api/tests/paynotes/live/scenarios/fetch-by-id-fallback.smoke.integration.test.ts` – blueprint małego smoke testu dla fallback path `{ id: eventId }`.
- `repo-overlay/apps/bank-api/tests/paynotes/e2e/lib/WebhookQueuePoller.ts` – fallback pod istniejący webhook → queue pipeline.
- `repo-overlay/apps/bank-api/tests/paynotes/.env.agent.example` – plik wejściowy dla agenta z `MYOS_BASE_URL`, `MYOS_API_KEY`, `MYOS_ACCOUNT_ID`.
- `repo-overlay/apps/bank-api/tests/paynotes/live/fixtures/documents/*` – fixture’y źródłowe + scaled fixtures z małymi kwotami; overlay zakłada `LLM_SUMMARY_DISABLED: true` oraz komplet pól potrzebnych do deterministic summary.
- `repo-overlay/apps/bank-api/tests/paynotes/live/scenarios/*` – scenariusze proste i złożone jako blueprint dla implementacji.
- `PROMPT_FOR_CURSOR.md` – prompt wymuszający iteracyjny delivery, raportowanie, małe commity, twarde kryteria zakończenia i brak zmian w bank implementation.
