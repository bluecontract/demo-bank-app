import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventInput,
  HandleWebhookEventResult,
} from './paynoteWebhook/types';
import {
  resolveWebhookContext,
  resolveWebhookPayload,
} from './paynoteWebhook/payload';
import {
  buildPayNoteRecord,
  persistPayNoteRecord,
  resolveDeliveryRecord,
  resolvePayNoteDocumentId,
  resolvePayNoteParsed,
} from './paynoteWebhook/records';
import { handleCaptureRequestEvents } from './paynoteWebhook/captureRequests';
import { handleTransferEvents } from './paynoteWebhook/transfers';
import { trace } from './paynoteWebhook/logging';
import { getString } from './paynoteWebhook/utils';

export type {
  HandleWebhookEventDependencies,
  HandleWebhookEventInput,
  HandleWebhookEventResult,
} from './paynoteWebhook/types';

export const handleWebhookEvent = async (
  input: HandleWebhookEventInput,
  deps: HandleWebhookEventDependencies
): Promise<HandleWebhookEventResult> => {
  const logs: HandleWebhookEventResult['logs'] = [];
  trace(logs, 'PayNote webhook processing', {
    eventId: input.eventId,
    hasPayload: Boolean(input.eventPayload),
  });

  const payloadResolution = await resolveWebhookPayload(input, deps, logs);
  if ('result' in payloadResolution) {
    return payloadResolution.result;
  }

  const contextResolution = resolveWebhookContext(
    payloadResolution.payload,
    input.eventId,
    logs
  );
  if ('result' in contextResolution) {
    return contextResolution.result;
  }

  const { eventObject, eventType, document, emittedEvents, events, sessionId } =
    contextResolution.context;

  const firstProcess = await deps.payNoteRepository.markEventProcessed(
    input.eventId
  );
  if (!firstProcess) {
    trace(logs, 'PayNote webhook already processed', {
      eventId: input.eventId,
    });
    return { note: '', logs };
  }

  trace(logs, 'Resolved PayNote session id', {
    eventId: input.eventId,
    sessionId,
  });

  const payNoteRecord = await deps.payNoteRepository.getPayNoteBySessionId(
    sessionId
  );

  const documentResolution = await resolvePayNoteDocumentId({
    eventId: input.eventId,
    sessionId,
    payNoteRecord,
    deps,
    logs,
  });

  if ('result' in documentResolution) {
    return documentResolution.result;
  }

  const { payNoteDocumentId, resolvedDocument } = documentResolution.resolution;

  const now = deps.clock.now().toISOString();
  const existingRecord =
    payNoteRecord ??
    (await deps.payNoteRepository.getPayNote(payNoteDocumentId));

  const deliveryRecord = await resolveDeliveryRecord(
    existingRecord,
    payNoteDocumentId,
    deps
  );

  trace(logs, 'Resolved PayNote delivery linkage', {
    eventId: input.eventId,
    payNoteDocumentId,
    hasPayNoteRecord: Boolean(existingRecord),
    deliveryId: deliveryRecord?.deliveryId ?? null,
  });

  const payNoteParsedResolution = resolvePayNoteParsed({
    document,
    resolvedDocument,
    eventId: input.eventId,
    sessionId,
    logs,
  });

  if ('result' in payNoteParsedResolution) {
    return payNoteParsedResolution.result;
  }

  const payNoteParsed = payNoteParsedResolution.parsed;
  const { updatedRecord, payerAccountNumber, payeeAccountNumber } =
    buildPayNoteRecord({
      payNoteDocumentId,
      sessionId,
      existingRecord,
      deliveryRecord,
      document,
      resolvedDocument,
      eventObject,
      payNoteParsed,
      now,
    });

  await persistPayNoteRecord({
    updatedRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
    eventObject,
    emittedEvents,
    now,
    deps,
  });

  logs.push({
    level: 'info',
    message: 'Received PayNote webhook',
    context: {
      eventId: input.eventId,
      events,
      payNoteDocumentId,
      payerAccountNumber,
      payeeAccountNumber,
    },
  });

  await handleCaptureRequestEvents({
    events,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    updatedRecord,
    eventObject,
    emittedEvents,
    deps,
    logs,
  });

  const transferDescription =
    getString(payNoteParsed.output.name) ?? 'PayNote transfer';

  const transferResult = await handleTransferEvents({
    events,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    emittedEvents,
    payerAccountNumber,
    payeeAccountNumber,
    transferDescription,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  });

  if (transferResult) {
    return transferResult;
  }

  return { note: '', logs };
};
