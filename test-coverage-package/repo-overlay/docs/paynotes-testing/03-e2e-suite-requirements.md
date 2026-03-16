# Real MyOS E2E suite requirements

## Preferowany model wykonania

Dla środowisk cloudowych preferowany jest

`pull-and-post` – test sam pobiera z MyOS tylko `DOCUMENT_CREATED` i `DOCUMENT_EPOCH_ADVANCED`, pobiera **pełny payload eventu** i wywołuje bank webhook z tym payloadem.

## Zasada synchronizacji

Synchronizacja ma być **jawna w teście**, ale helper może wewnętrznie wykonywać polling.

Docelowy wzorzec:

1. akcja biznesowa,
2. `await eventPump.flushUntilSettled(...)`,
3. asercje,
4. kolejna akcja.

Nie uruchamiaj globalnego background interval jako głównego mechanizmu obsługi eventów.

## Minimalne sekrety i env

### Wspólne

Agent ma czytać z `.env.agent`:

- `MYOS_BASE_URL`
- `MYOS_API_KEY`
- `MYOS_ACCOUNT_ID`

A następnie wystawiać je do runtime testów jako bezpośrednie env albo mapować do `MYOS_E2E_*`.

Dodatkowo:

- `PAYNOTE_E2E_RUN_ID`
- `PAYNOTE_E2E_EVENT_SOURCE_MODE`=pull-and-post
- `BANK_E2E_BASE_URL`
- `BANK_E2E_CARD_PROCESSOR_TOKEN` – jeśli nie nadpisujesz env banku, domyślnie bank używa `demo-bank-processor-token`
- `MYOS_E2E_TEST_MERCHANT_ID` -> merchant powinien być tworzony per test scenario z merchant id wygenerowanym jako uuid
- `MYOS_E2E_TEST_TARGET_MERCHANT_ID` -> merchant powinien być tworzony per test scenario z merchant id wygenerowanym jako uuid

### Summary / AI

- realny `OPENAI_API_KEY` nie jest wymagany, jeśli testowe fixture’y używają `LLM_SUMMARY_DISABLED: true`,
- jeśli bank boot wymaga obecności sekretu, seeded placeholder jest wystarczający,
- placeholder powinien mieć format JSON `{ "openAiApiKey": "dummy-not-used" }`.

### Dla `pull-and-post`

Agent / runner musi mieć dostęp do:

- `GET /myos-events?ref=<sessionId>&type=DOCUMENT_CREATED...`
- `GET /myos-events?ref=<sessionId>&type=DOCUMENT_EPOCH_ADVANCED...`
- `GET /myos-events/:eventId`
- `GET /documents/:sessionId`
- `POST /documents/bootstrap`
- `POST /documents/:sessionId/:operation`

## Wymagania operacyjne

- suite serial dla live/e2e,
- dedup po `eventId`,
- pełne logowanie `runId / sessionId / eventId / requestId`,
- cleanup dynamicznych webhooków tylko jeśli runner ma do tego uprawnienia,
- cleanup nie może być warunkiem zaliczenia testu.

## Wymagania dla danych testowych

- osobny sandbox/tenant MyOS,
- osobne credentiale tylko dla suite’y,
- oddzielone merchanty testowe,
- unikalny prefix per run dla `requestId` i nazw dokumentów,
- zasilone konta testowe,
- flow kartowe zawsze przez helper tworzący konto + funding + kartę,
- kwoty w fixture’ach i scenariuszach trzymane < `100_000` minor,
- funding buffer większy niż suma planowanych capture/reserve w scenariuszu.
- bootstrap osobnej sesji Synchrony Merchant per test run dla dostarczania PayNote Delivery (przykład bootstrap payload przykład bootstrap payload demo-bank-app/test-coverage-package/repo-overlay/docs/paynotes-testing/synchrony-merch-boot.local.yaml)

## Wymagania dla runnera

### Cursor Cloud

Musi mieć:

- outbound HTTP do MyOS i do bank test env,
- możliwość uruchomienia repo i LocalStack/SAM albo połączenia do gotowego bank env,
- możliwość przechowywania sekretów środowiskowych,
- brak konieczności posiadania publicznego webhook URL w trybie domyślnym,
- możliwość podstawienia `.env.agent` do środowiska runów.
