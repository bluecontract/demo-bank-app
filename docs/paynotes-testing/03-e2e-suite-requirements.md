# Real MyOS E2E suite requirements

## Preferred execution model

For cloud or remote runners, the preferred model is:

`pull-and-post` — the test reads only `DOCUMENT_CREATED` and
`DOCUMENT_EPOCH_ADVANCED` from MyOS, downloads the full event payload, and
forwards it to the bank.

## Synchronization rule

Synchronization must be explicit in the test:

1. perform a business action
2. `await eventPump.flushUntilSettled(...)`
3. assert outcomes
4. continue to the next action

Do not use a global background interval as the main event-delivery mechanism.

## Minimum environment

The runner should read from the repository root `.env.agent`:

- `MYOS_BASE_URL`
- `MYOS_API_KEY`
- `MYOS_ACCOUNT_ID`
- `BANK_MYOS_API_KEY`
- `BANK_MYOS_ACCOUNT_ID`

Additional runtime inputs:

- `PAYNOTE_E2E_RUN_ID`
- `PAYNOTE_E2E_EVENT_SOURCE_MODE=pull-and-post`
- `BANK_E2E_BASE_URL`
- `BANK_E2E_CARD_PROCESSOR_TOKEN`
- per-scenario test merchant IDs

## Summary / AI

- a real OpenAI key is not required when fixtures use
  `LLM_SUMMARY_DISABLED: true`
- if local boot requires the secret to exist, a placeholder is sufficient:

```json
{ "openAiApiKey": "dummy-not-used" }
```

## Required MyOS HTTP access

The runner must be able to access:

- `GET /myos-events?ref=<sessionId>&type=DOCUMENT_CREATED...`
- `GET /myos-events?ref=<sessionId>&type=DOCUMENT_EPOCH_ADVANCED...`
- `GET /myos-events/:eventId`
- `GET /documents/:sessionId`
- `POST /documents/bootstrap`
- `POST /documents/:sessionId/:operation`

## Operational requirements

- serial suite for live/E2E flows
- dedup by `eventId`
- logging for `runId`, `sessionId`, `eventId`, and request identifiers
- no mandatory webhook administration when `pull-and-post` works
