# PayNote tests

## Podział

- `live/` – bank + LocalStack + MyOS harness / live protocol tests.
- `e2e/` – mała suite canary dla real MyOS.

## Zasady

- używaj helperów setup zamiast ręcznego boilerplate,
- konto musi być zasilone z buforem,
- flow kartowe muszą używać helpera tworzącego konto + funding + kartę,
- nowe proste/scaled scenariusze mają używać kwot < 100_000 minor units,
- dla live/e2e forwarduj do banku **pełny payload webhooka** pobrany z MyOS,
- `POST { id: eventId }` zostaw tylko jako mały smoke test fallback path,
- preferuj `pull-and-post`,
- event sync ma być jawny w teście,
- do fixture’ów testowych dodawaj `LLM_SUMMARY_DISABLED: true` razem z `summary`, `details` i `initialMessage`,
- agent ma czytać MyOS credentiale z pliku `.env.agent` (`MYOS_BASE_URL`, `MYOS_API_KEY`, `MYOS_ACCOUNT_ID`).

## Sugestia targetów

Scal snippet z `apps/bank-api/project.paynotes-targets.snippet.json` do realnego `project.json`.
