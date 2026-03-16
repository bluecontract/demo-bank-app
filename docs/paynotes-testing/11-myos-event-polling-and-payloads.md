# MyOS event polling and payloads

## Forward only two event types

PayNote tests should forward only:

- `DOCUMENT_CREATED`
- `DOCUMENT_EPOCH_ADVANCED`

Do not forward other MyOS event types in the main live/E2E flow.

## Event-list queries

For a single `sessionId`, query both lists:

```http
GET /myos-events?ref=<sessionId>&type=DOCUMENT_CREATED&itemsPerPage=100&from=<ISO>
GET /myos-events?ref=<sessionId>&type=DOCUMENT_EPOCH_ADVANCED&itemsPerPage=100&from=<ISO>
```

Additional filtering rules:

- for `DOCUMENT_CREATED`: `ref === sessionId`
- for `DOCUMENT_EPOCH_ADVANCED`: `ref.startsWith(sessionId + ':')`

## Sorting

Recreate the dispatch order as:

1. `DOCUMENT_CREATED`
2. `DOCUMENT_EPOCH_ADVANCED` ordered by ascending `epoch`
3. ascending `created`
4. ascending `id`

## Full payload download

For each event ID:

```http
GET /myos-events/:eventId
Authorization: <raw-api-key>
Content-Type: application/json
```

This is the real-case payload to forward in `pull-and-post`.

## Compatibility smoke

Keep `POST /v1/paynotes/webhook` with `{ "id": "<eventId>" }` only as a small
compatibility smoke for the bank's fallback `fetchEvent` path.
