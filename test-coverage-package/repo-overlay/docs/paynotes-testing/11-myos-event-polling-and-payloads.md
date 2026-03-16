# MyOS event polling and payloads

## Tylko dwa typy eventów

Testy PayNote mają pobierać i forwardować tylko:

- `DOCUMENT_CREATED`
- `DOCUMENT_EPOCH_ADVANCED`

Nie forwarduj:

- `DOCUMENT_UPDATED`
- `DOCUMENT_PROCESSING_ERROR`
- `DOCUMENT_PROCESSING_PAUSED`
- `DOCUMENT_PROCESSING_RESUMED`
- innych eventów MyOS.

To jest zgodne zarówno z implementacją banku, jak i z realnym sortowaniem dispatchu w lcloud.

## Jak pobierać eventy

Dla konkretnego `sessionId` użyj dwóch zapytań listujących:

```http
GET /myos-events?ref=<sessionId>&type=DOCUMENT_CREATED&itemsPerPage=100&from=<ISO>
GET /myos-events?ref=<sessionId>&type=DOCUMENT_EPOCH_ADVANCED&itemsPerPage=100&from=<ISO>
```

W lcloud:

- query `ref` jest filtrem `contains`, więc po stronie testu dodatkowo sprawdź:
  - dla `DOCUMENT_CREATED`: `ref === sessionId`
  - dla `DOCUMENT_EPOCH_ADVANCED`: `ref.startsWith(sessionId + ':')`
- lista wraca malejąco po `created`, więc przed delivery trzeba posortować lokalnie.

## Sortowanie zgodne z lcloud

W lcloud `compareWebhookDispatches(...)` ustawia priorytety:

1. `DOCUMENT_CREATED` – priorytet 0,
2. `DOCUMENT_UPDATED` / processing error / paused / resumed – priorytet 1,
3. `DOCUMENT_EPOCH_ADVANCED` – priorytet 2.

Ponieważ w testach PayNote bierzemy tylko dwa typy, odtwórz kolejność dispatchu tak:

1. `DOCUMENT_CREATED` przed `DOCUMENT_EPOCH_ADVANCED`,
2. dla `DOCUMENT_EPOCH_ADVANCED` sortuj rosnąco po `epoch` wyciągniętym z `ref = "<sessionId>:<epoch>"`,
3. jeśli nadal remis, sortuj rosnąco po `created`,
4. jeśli nadal remis, sortuj rosnąco po `id`.

## Jak pobrać pełny payload

Dla każdego wybranego eventu pobierz:

```http
GET /myos-events/:eventId
Authorization: <raw-api-key>
Content-Type: application/json
```

To jest ten sam obiekt zdarzenia, który lcloud bierze z `MyOSEventClient.get(event.id)` przed serializacją webhooka.
Dla banku testowego to jest właściwy **real-case payload** do `pull-and-post`.

## Format realnego payloadu webhooka

### `DOCUMENT_CREATED`

```json
{
  "id": "<eventId>",
  "type": "DOCUMENT_CREATED",
  "uid": "<uid>",
  "created": "2026-03-14T10:11:12.000Z",
  "ref": "<sessionId>",
  "object": {
    "sessionId": "<sessionId>",
    "created": "2026-03-14T10:11:12.000Z",
    "blueId": "<blueId>",
    "document": { "...": "..." },
    "triggeredBy": null,
    "emitted": [{ "...": "..." }]
  }
}
```

### `DOCUMENT_EPOCH_ADVANCED`

```json
{
  "id": "<eventId>",
  "type": "DOCUMENT_EPOCH_ADVANCED",
  "uid": "<uid>",
  "created": "2026-03-14T10:12:30.000Z",
  "ref": "<sessionId>:3",
  "object": {
    "sessionId": "<sessionId>",
    "epoch": 3,
    "created": "2026-03-14T10:12:30.000Z",
    "blueId": "<blueId>",
    "document": { "...": "..." },
    "emitted": [{ "...": "..." }],
    "triggeredBy": { "...": "..." }
  }
}
```

## Realne nagłówki webhooka z lcloud

Przy prawdziwym HTTPS webhooku lcloud dodaje m.in.:

- `content-type: application/json`
- `x-myos-delivery-id`
- `x-myos-webhook-id`
- `x-myos-event-id`
- `x-myos-event-type`
- `x-myos-timestamp`
- `content-digest`
- `blue-context`
- opcjonalny auth header,
- opcjonalnie `Signature-Input` i `Signature`.

Bank obecnie nie waliduje tych nagłówków na endpointzie PayNote webhook, więc dla `pull-and-post` krytyczny jest **body**, nie komplet nagłówków.

## Rekomendacja dla testów

### Główny mechanizm live/e2e

- list MyOS event ids,
- pobierz pełny payload `GET /myos-events/:id`,
- `POST /v1/paynotes/webhook` z tym payloadem bez modyfikacji.

### Dodatkowy smoke

- `POST /v1/paynotes/webhook` z `{ "id": "<eventId>" }`,
- tylko po to, żeby sprawdzić bankowy fallback `fetchEvent` path,
- ten smoke może używać MyOS harnessu i powinien potwierdzać, że bank rzeczywiście wykonał `GET /myos-events/:eventId`.
