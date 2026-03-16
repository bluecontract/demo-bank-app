# PayNote real MyOS canaries

This suite must stay small, serial, and intentionally selective.

## Preferred delivery modes

1. `pull-and-post`
2. `sqs-poller`
3. `direct-webhook`

## Important constraints

- direct webhook delivery to an ephemeral runner is the last resort
- if only one webhook per callback URL is allowed, the suite must stay serial
- if the MyOS event-read API is stable, do not manage MyOS webhooks in tests
- forward only `DOCUMENT_CREATED` and `DOCUMENT_EPOCH_ADVANCED`
- keep the `{ "id": eventId }` webhook body as a tiny compatibility smoke path,
  not the main live/E2E mechanism
