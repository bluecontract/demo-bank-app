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
import {
  handleTransferEvents,
  handleTransferMandateResponseEvents,
} from './paynoteWebhook/transfers';
import { dispatchPayNoteEvents } from './paynoteWebhook/eventDispatcher';
import { handleMonitoringRequestEvents } from './paynoteWebhook/monitoring';
import {
  handleChargeRequestEvents,
  handleMandateResponseEvents,
} from './paynoteWebhook/chargeRequests';
import { trace } from './paynoteWebhook/logging';
import { getString } from './paynoteWebhook/utils';
import { toCompactBlueJsonValue } from '../blue/compactBlue';

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const parseIsoTimestamp = (value: string): number | null => {
  if (!value.includes('T')) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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

  const {
    eventPayload,
    eventObject,
    eventType,
    document,
    emittedEvents,
    events,
    sessionId,
  } = contextResolution.context;

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

  const { payNoteDocumentId, resolvedDocument, resolvedDocumentRaw } =
    documentResolution.resolution;

  const existingPayNoteByDocumentId =
    payNoteRecord ??
    (await deps.payNoteRepository.getPayNote(payNoteDocumentId));
  const incomingEventCreatedAt = getString(
    (eventPayload as { created?: unknown })?.created
  );
  const lastSourceEventCreatedAt = getString(
    existingPayNoteByDocumentId?.lastSourceEventCreatedAt
  );
  const incomingEventCreatedAtMs = incomingEventCreatedAt
    ? parseIsoTimestamp(incomingEventCreatedAt)
    : null;
  const lastSourceEventCreatedAtMs = lastSourceEventCreatedAt
    ? parseIsoTimestamp(lastSourceEventCreatedAt)
    : null;
  if (
    incomingEventCreatedAt &&
    lastSourceEventCreatedAt &&
    incomingEventCreatedAtMs !== null &&
    lastSourceEventCreatedAtMs !== null &&
    incomingEventCreatedAtMs < lastSourceEventCreatedAtMs
  ) {
    logs.push({
      level: 'info',
      message:
        'PayNote webhook event ignored (older than last processed source event)',
      context: {
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        incomingEventCreatedAt,
        lastSourceEventCreatedAt,
      },
    });
    return { note: '', logs };
  }
  const canonicalContract =
    await deps.contractRepository.getContractByDocumentId(payNoteDocumentId);
  const canonicalSessionId = getString(canonicalContract?.sessionId);
  if (canonicalSessionId && canonicalSessionId !== sessionId) {
    logs.push({
      level: 'info',
      message: 'PayNote webhook event ignored (non-canonical session)',
      context: {
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        canonicalSessionId,
      },
    });
    return { note: '', logs };
  }
  const eventEpoch = eventObject?.epoch;
  const isEpochAdvancedWithoutCanonicalSession =
    eventType === 'DOCUMENT_EPOCH_ADVANCED' &&
    typeof eventEpoch === 'number' &&
    eventEpoch > 0 &&
    !canonicalSessionId;
  if (isEpochAdvancedWithoutCanonicalSession) {
    logs.push({
      level: 'info',
      message:
        'PayNote webhook event ignored (canonical session not established yet)',
      context: {
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        eventType,
        eventEpoch,
      },
    });
    return { note: '', logs };
  }

  const now = deps.clock.now().toISOString();
  const existingRecord = existingPayNoteByDocumentId;
  const nextSourceEventCreatedAt =
    incomingEventCreatedAt &&
    incomingEventCreatedAtMs !== null &&
    (!lastSourceEventCreatedAt ||
      lastSourceEventCreatedAtMs === null ||
      incomingEventCreatedAtMs >= lastSourceEventCreatedAtMs)
      ? incomingEventCreatedAt
      : lastSourceEventCreatedAt;

  const deliveryRecord = await resolveDeliveryRecord(
    existingRecord,
    payNoteDocumentId,
    deps
  );
  const bootstrapContext =
    await deps.bootstrapContextRepository.getContextBySessionId(sessionId);

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
      bootstrapMerchantId: bootstrapContext?.merchantId,
      bootstrapAccountNumber: bootstrapContext?.accountNumber,
      bootstrapUserId: bootstrapContext?.userId,
      document,
      resolvedDocument,
      eventObject,
      eventCreatedAt: nextSourceEventCreatedAt,
      payNoteParsed,
      now,
    });

  await persistPayNoteRecord({
    updatedRecord,
    deliveryRecord,
    documentForStorage:
      asRecord(toCompactBlueJsonValue(eventObject?.document)) ??
      asRecord(toCompactBlueJsonValue(resolvedDocumentRaw)) ??
      updatedRecord.document,
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

  const {
    captureRequestEvents,
    chargeRequestEvents,
    mandateResponseEvents,
    transferEvents,
    monitoringRequestEvents,
  } = dispatchPayNoteEvents({
    events,
    eventId: input.eventId,
    payNoteDocumentId,
    logs,
  });

  await handleMonitoringRequestEvents({
    events: monitoringRequestEvents,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    deps,
    logs,
  });

  await handleCaptureRequestEvents({
    events: captureRequestEvents,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    updatedRecord,
    eventObject,
    emittedEvents,
    deps,
    logs,
  });

  const chargeResult = await handleChargeRequestEvents({
    events: chargeRequestEvents,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  });

  if (chargeResult) {
    return chargeResult;
  }

  const mandateResponseResult = await handleMandateResponseEvents({
    events: mandateResponseEvents,
    eventId: input.eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    deps,
    logs,
  });

  if (mandateResponseResult) {
    return mandateResponseResult;
  }

  const transferMandateResponseResult =
    await handleTransferMandateResponseEvents({
      events: mandateResponseEvents,
      eventId: input.eventId,
      payNoteDocumentId,
      sessionId,
      deps,
      logs,
    });

  if (transferMandateResponseResult) {
    return transferMandateResponseResult;
  }

  const transferDescription =
    getString(payNoteParsed.output.name) ?? 'PayNote transfer';

  const transferResult = await handleTransferEvents({
    events: transferEvents,
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
