# Event delivery strategy

## Problem

For real MyOS E2E, event delivery to the bank is often the most fragile part of
the flow:

- direct webhook delivery can become unstable
- one webhook per URL can make parallel runs unsafe
- background polling and webhook lifecycle management reduce determinism
- the bank should receive only the event types it actually reacts to

## Preferred strategy

### A. `pull-and-post`

The test reads MyOS event IDs, downloads the full payload, and forwards the
real webhook payload to the bank.

Benefits:

- no public runner URL required
- no dynamic webhook creation required
- deterministic event-by-event debugging
- body shape matches the real MyOS webhook payload

### B. `sqs-poller`

Use a stable queue-backed webhook target and poll event IDs from the queue only
if the MyOS read API is not sufficient.

### C. `direct-webhook`

Use only when the runner has a stable URL and webhook lifecycle can be managed
deterministically.

## Rules for `pull-and-post`

- explicit sync point after each business action
- helper-internal polling is fine; a global background interval is not
- dedup by `eventId`
- sort only the two relevant types exactly as the documented dispatch order
  requires
- wait for a short quiet period before considering the system settled
