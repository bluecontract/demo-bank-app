# Demo bank PayNote test package for Cursor / Codex

Ta paczka jest przygotowana jako **overlay + prompt operacyjny** dla agenta, który ma dowieźć mocne testy PayNote iteracyjnie, z raportowaniem i bez zmian w implementacji banku.

## Co zawiera

- `repo-overlay/` – pliki, które mają trafić do repo lub posłużyć jako blueprint.
- `PROMPT_FOR_CURSOR.md` – główny prompt wykonawczy dla Cursor Cloud / Cursor Agent.
- `APPLY_INSTRUCTIONS.md` – jak użyć tej paczki.
- `PACKAGE_CONTENTS.md` – spis najważniejszych plików.
- `SECRETS_HANDOFF_CHECKLIST.md` – minimalny handoff env / sekretów / dostępów.

## Najważniejsze decyzje w tej wersji

- repo bazowe w zipie jest **pełnym codebase'em**; agent ma korzystać z realnych plików repo, nie zgadywać,
- kwoty PayNote są w **minor units**; przykładowo `100 = 1 USD`,
- testy mają używać **jawnego helpera synchronizacji** po akcji biznesowej,
- testy mają pobierać z MyOS i obsługiwać tylko **`DOCUMENT_CREATED`** oraz **`DOCUMENT_EPOCH_ADVANCED`**,
- domyślny model live/e2e to **pull-and-post z full payloadem**: test pobiera event z MyOS i postuje do banku **pełny payload webhooka**,
- tryb `{ id: eventId }` zostaje tylko jako **mały smoke / compatibility path** dla bankowego `fetchEvent`,
- nie polegamy domyślnie na tunelach, lokalnych pollerach ani dynamicznych webhookach,
- do uniknięcia OpenAI w testach należy używać fixture’ów z `LLM_SUMMARY_DISABLED: true`, ale wtedy fixture musi też zawierać właściwe pola w `payNoteInitialStateDescription`,
- agent ma używać pliku **`.env.agent`** do przekazania `MYOS_BASE_URL`, `MYOS_API_KEY`, `MYOS_ACCOUNT_ID`.

## Dodatkowo sprawdzone w kodzie repo

- bankowy webhook działa na endpointzie `/v1/paynotes/webhook`, a gdy dostanie tylko `id`, sam pobiera payload z MyOS,
- realny domyślny token procesora kart w banku to **`demo-bank-processor-token`**, jeśli `CARD_PROCESSOR_TOKEN` nie jest nadpisany,
- mock summary dla `LLM_SUMMARY_DISABLED` bierze treść z `payNoteInitialStateDescription.summary` i `payNoteInitialStateDescription.details`, a proposal headline dodatkowo z `payNoteInitialStateDescription.initialMessage`,
- jeżeli jakiś bootstrap lokalnego systemu mimo wszystko wymaga obecności sekretu OpenAI, wystarczy **dummy placeholder**; realny key nie jest wymagany dla głównej suite.

## Założenia

- celem są **solidne testy i dokumentacja**,
- celem **nie są zmiany w implementacji banku**,
- jeśli test ujawnia bug lub blocker, agent ma zostawić test i udokumentować root cause, zamiast naprawiać kod produkcyjny.
