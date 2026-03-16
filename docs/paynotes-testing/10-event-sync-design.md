# Event sync design

## Decision

PayNote tests use an explicit synchronization helper after each business action.

Do not run a global background interval that constantly fetches MyOS events.

## Why

Explicit sync points provide:

- predictable action ordering
- easier logging and debugging
- simple `eventId` dedup
- fewer hidden race conditions

## Expected usage

```ts
await flow.acceptDelivery(...);
await eventPump.flushUntilSettled({
  sessionIds: [sessionId],
  assertSettled: async () => {
    // bank-side assertions
  },
});
```

## Helper responsibilities

1. fetch new MyOS events from the current watermark
2. keep only `DOCUMENT_CREATED` and `DOCUMENT_EPOCH_ADVANCED`
3. ignore already processed `eventId`s
4. sort them in the documented dispatch order
5. download the full payload for each event
6. post the full payload to the bank webhook
7. wait until the bank-side assertion and quiet period both succeed
