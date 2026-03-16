# PayNote testing docs

Ten katalog zostawiamy w repo jako dokumentację projektową i operacyjną dla suite’y PayNote.

## Co zawiera

- `01-strategy-and-split.md` – docelowy podział warstw testów.
- `02-scenario-catalog.md` – katalog scenariuszy od prostych po złożone.
- `03-e2e-suite-requirements.md` – wymagane sekrety, env i zasady dla real MyOS E2E.
- `04-known-gaps-and-blockers.md` – znane luki i ryzyka do dokumentowania, nie do naprawiania w tym tracku.
- `05-extension-policy.md` – zasady rozszerzania suite’y.
- `06-runner-decision-matrix.md` – kiedy użyć Cursor Cloud, a kiedy lokalnego runnera.
- `07-cursor-agent-playbook.md` – jak agent ma pracować i raportować.
- `08-reporting-templates.md` – wzory workloga i rejestru bugów.
- `09-webhook-strategy.md` – strategia obsługi webhooków i event delivery dla cloud/local.
- `10-event-sync-design.md` – dokładny model jawnego event sync helpera.
- `11-myos-event-polling-and-payloads.md` – dokładne instrukcje pobierania i sortowania `DOCUMENT_CREATED` / `DOCUMENT_EPOCH_ADVANCED` oraz format realnego payloadu webhooka.
- `12-summary-disabled-fixture-requirements.md` – jakie pola muszą mieć fixture’y przy `LLM_SUMMARY_DISABLED: true`.
