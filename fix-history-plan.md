# Fix Plan: Duplicate Contract History Entries

## Context

We are seeing duplicate history entries on PayNote contract pages even after fixing duplicate MyOS operation invocations. Example (contract `14da32de-5749-5db9-b2df-e9dbf88ab3cd`):

- **Bank confirmed the card capture is locked for $5.00.** (01:51 AM)
- **Bank asked to lock the card capture for $5.00.** (01:51 AM)
- **Bank asked to lock the card capture for $5.00.** (01:50 AM)

So operations are not duplicated anymore, but the history log still contains repeated, semantically identical updates.

## Current Flow (as implemented)

- PayNote webhooks (`apps/bank-api/src/paynote/webhook.ts`) enqueue contract summary jobs once per webhook event (`contractRepository.markSummaryEventProcessed(eventId)`).
- Summary worker calls `generateContractSummary` which:
  - Builds summary inputs from `contract.document`, status, status timestamps, trigger event, emitted events.
  - Uses LLM to return structured summary including `lastChange`.
  - Adds a history entry derived from `summary.lastChange`.
  - History id uses `triggerEventMeta.blueId` when available, otherwise `summary:<createdAt>`.
  - Duplicate suppression only compares against the **latest** history entry, or any entry with the same history id.

## Observations

- Duplicates still happen when multiple webhooks produce summaries that result in the **same** last-change text, or when trigger metadata is missing/unstable.
- Dedupe is limited: it only compares the latest entry text, not all existing history entries.
- `triggerEvent` is stored on contract from webhook `eventObject.triggeredBy`. If that object can’t be parsed into a Blue node or lacks a stable BlueId/timestamp, history ids become timestamp-based (`summary:<createdAt>`), making duplicates likely.
- Summary input BlueId may change even if the state change is “equivalent”, because timestamps in `statusUpdatedAt`/`statusTimestamps` differ.

## Hypotheses

1. **Trigger metadata is missing/unstable**

   - `triggerEvent` in the contract record lacks a stable BlueId or timestamp. History id falls back to timestamp → duplicates across close events.

2. **LLM lastChange is state-driven, not event-driven**

   - The LLM produces the same lastChange for different events because the prompt favors current state over the actual triggering event.

3. **Summary input changes due to timestamps only**

   - `summaryInputBlueId` is sensitive to timestamp fields, causing regeneration even when state meaningfully hasn’t changed.

4. **Multiple related webhook events drive summaries for similar transitions**
   - Distinct webhook events (delivery + PayNote) can cause multiple summary runs with near-identical output, and our dedupe logic only checks the latest entry.

## Fix Options (Hypothesis Mitigation)

### A) Enforce stable history IDs

- Always compute a history id from `triggerEvent` by converting to Blue node and calculating BlueId. If that fails, fall back to webhook eventId or a deterministic hash of the trigger payload.
- Persist the webhook eventId into the contract record so `generateContractSummary` can always use it as a stable history id.

### B) Strengthen history dedupe

- Compare new history entry against **all existing entries** (or last N) and skip when `(short, more)` matches exactly within a configurable time window (e.g., same minute or same day).
- If `historyId` missing, fallback to a text-based dedupe across entire history.

### C) Make lastChange event-specific

- Update summary prompt to require that `lastChange` describe the triggering event, not just the overall state. Provide `transition.triggerEvent` + actor to the model and require distinct phrasing per event type.
- Optionally introduce deterministic mapping for known PayNote events (lock requested/confirmed, delivery identified, etc.) and bypass LLM for `lastChange` generation.

### D) Stabilize summary input BlueId

- Exclude pure-timestamp fields (`statusUpdatedAt`, `statusTimestamps`) from the `summaryInputBlueId` calculation (or normalize them), so that summary regeneration does not happen unless the contract’s meaningful state changes.

## Recommended Approach (Order of Implementation)

1. **Stabilize history IDs**: ensure `triggerEventMeta.blueId` is always present or use webhook eventId fallback.
2. **Strengthen history dedupe**: skip if `(short, more)` already exists in history (not only the latest), especially when no stable trigger id is present.
3. **Prompt update for lastChange**: explicitly bind `lastChange` to `triggerEvent` semantics so distinct events produce distinct entries.
4. **Normalize summary input**: if duplicates persist, adjust summary input to ignore timestamp-only changes.

## Validation Plan

- Create a new PayNote flow and watch history as:
  1. proposal created,
  2. delivery identified,
  3. capture lock requested,
  4. capture lock confirmed.
- Confirm:
  - Each webhook event produces **one** history entry.
  - No repeated `lastChange` entries when events differ.
  - If an event replays, history does not get a duplicate entry.
- Verify `historyId` is stable across retries (inspect Dynamo history SK/ID).

## Notes

- This plan does not change business operations or MyOS interaction; it only stabilizes summary generation + history logging.
- The user-visible list preview should mirror the summary’s headline; ensure summaryPreview and history stay consistent with the contract view.
