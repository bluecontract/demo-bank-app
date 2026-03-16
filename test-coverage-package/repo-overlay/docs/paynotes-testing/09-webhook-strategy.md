# Event delivery strategy

## Problem

Dla real MyOS E2E najbardziej wrażliwym elementem jest dostarczenie eventów do banku:

- direct webhook może wejść w stan broken,
- tylko jeden webhook per URL oznacza ryzyko duplikacji przy równoległych suite’ach,
- background polling i webhook lifecycle psują deterministykę,
- bank powinien dostawać tylko te eventy, na które realnie reaguje: `DOCUMENT_CREATED` i `DOCUMENT_EPOCH_ADVANCED`.

## Strategia preferowana

### A. `pull-and-post`

Test sam pobiera z MyOS event list / event payload i postuje do banku **realny payload webhooka**.

Zalety:

- brak potrzeby publicznego URL dla runnera,
- brak potrzeby tworzenia i usuwania webhooków,
- brak zależności od tuneli i lokalnych pollerów,
- najprostsza diagnostyka event-by-event,
- realny format payloadu, zgodny z MyOS webhook body.

### B. `sqs-poller`

MyOS → stabilny webhook target → API Gateway / SQS → test poller → bank webhook z payloadem albo po pobraniu payloadu z MyOS.

To jest dobry fallback, jeśli MyOS nie daje stabilnego event feedu do odczytu przez test.

### C. `direct-webhook`

Tylko dla stabilnego URL i wyraźnie zarządzanego lifecycle.

## Zasady dla `pull-and-post`

- jawny sync point po akcji biznesowej,
- wewnętrzny polling w helperze, nie globalny interval,
- dedup po `eventId`,
- sortowanie zgodne z logiką lcloud dla tych dwóch typów:
  - `DOCUMENT_CREATED` przed `DOCUMENT_EPOCH_ADVANCED`,
  - epoch advanced rosnąco po `epoch`,
  - potem `created`,
  - potem `id`,
- quiet period przed uznaniem systemu za settled,
- **nie forwarduj innych typów**.

## Mały smoke dla `{ id }`

Bank umie też przyjąć body `{ id: eventId }` i sam pobrać payload z MyOS. To warto zachować jako 1 mały smoke test kompatybilności, ale nie jako główny mechanizm live suite.

## Zasady dla `direct-webhook`

- serial only,
- deterministic webhook name lub ID,
- create-or-update zamiast create-blindly,
- preflight check: dokładnie jeden webhook dla URL,
- cleanup / disable po runie,
- walidacja, że webhook nie jest broken.

## Dedup i observability

Niezależnie od trybu:

- loguj `eventId`, `sessionId`, `requestId`, `runId`,
- deduplikuj po `eventId`,
- przy failu zrzucaj ostatnie event ids i ostatni znany watermark / cursor.
