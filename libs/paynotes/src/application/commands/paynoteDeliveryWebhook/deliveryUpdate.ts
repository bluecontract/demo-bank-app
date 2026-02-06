import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { LogEntry, PayNoteDeliveryRecord } from '../../ports';
import {
  getCardTransactionDetailsFromDocument,
  getDeliveryNameFromDocument,
  getPayNoteSummaryFromDocument,
} from '../../payNoteDelivery/blueUtils';
import { upsertContractRecord } from '../../contracts';
import { log, trace } from '../paynoteWebhook/logging';
import { getString, toSimpleRecord } from '../paynoteWebhook/utils';
import type {
  HandlePayNoteDeliveryWebhookDependencies,
  WebhookEventObject,
} from './types';
import { resolveDeliveryDocumentId } from './documents';
import { buildDeliveryRecord, resolveExistingDelivery } from './records';
import {
  identifyDeliveryTransaction,
  reportIdentificationStatusIfNeeded,
} from './identification';
import { syncHoldPayNoteReference } from './holds';

const persistDeliveryRecord = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  sessionId?: string;
  deliveryDocumentId?: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  emitted: unknown[];
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<void> => {
  const {
    deliveryRecord,
    sessionId,
    deliveryDocumentId,
    eventType,
    eventObject,
    emitted,
    now,
    deps,
  } = input;

  await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);
  await upsertContractRecord({
    contractRepository: deps.contractRepository,
    document: deliveryRecord.deliveryDocument,
    sessionId,
    documentId: deliveryRecord.deliveryDocumentId ?? deliveryDocumentId,
    eventType,
    userId: deliveryRecord.userId,
    accountNumber: deliveryRecord.accountNumber,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents: emitted,
    relatedTransactionIds: deliveryRecord.transactionId
      ? [deliveryRecord.transactionId]
      : undefined,
    relatedHoldIds: deliveryRecord.holdId ? [deliveryRecord.holdId] : undefined,
    merchantId: deliveryRecord.merchantId,
    status:
      deliveryRecord.clientDecisionStatus ??
      deliveryRecord.transactionIdentificationStatus ??
      deliveryRecord.deliveryStatus,
    statusTimestamps: {
      ...(deliveryRecord.deliveryUpdatedAt && {
        deliveryUpdatedAt: deliveryRecord.deliveryUpdatedAt,
      }),
      ...(deliveryRecord.identificationReportedAt && {
        identificationReportedAt: deliveryRecord.identificationReportedAt,
      }),
      ...(deliveryRecord.decisionRecordedAt && {
        decisionRecordedAt: deliveryRecord.decisionRecordedAt,
      }),
      ...(deliveryRecord.payNoteBootstrapRequestedAt && {
        payNoteBootstrapRequestedAt: deliveryRecord.payNoteBootstrapRequestedAt,
      }),
    },
    now,
  });
};

const getPayNoteBootstrapDocument = (
  documentPayload: Record<string, unknown>
): Record<string, unknown> | null => {
  const request = toSimpleRecord(documentPayload.payNoteBootstrapRequest);
  return toSimpleRecord(request?.document);
};

export const handleDeliveryDocumentUpdate = async (input: {
  eventId: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  documentPayload: Record<string, unknown>;
  emitted: unknown[];
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    eventId,
    eventType,
    eventObject,
    documentPayload,
    emitted,
    now,
    deps,
    logs,
  } = input;

  const cardDetails = getCardTransactionDetailsFromDocument(documentPayload);
  if (!cardDetails) {
    log(logs, 'warn', 'Delivery event missing card transaction details', {
      eventId,
    });
    return;
  }

  const deliveryId = buildCardTransactionDetailsKey(cardDetails);
  const sessionId = getString(eventObject?.sessionId);

  const deliveryDocumentId = await resolveDeliveryDocumentId(
    sessionId,
    logs,
    deps
  );
  trace(logs, 'Resolved delivery document id', {
    eventId,
    sessionId,
    deliveryDocumentId: deliveryDocumentId ?? null,
  });

  const { existing, matchedBy } = await resolveExistingDelivery({
    deliveryDocumentId,
    sessionId,
    cardDetails,
    deps,
  });

  const deliveryRecord = buildDeliveryRecord({
    existing,
    deliveryId,
    cardDetails,
    documentPayload,
    eventObject,
    deliveryDocumentId,
    sessionId,
    now,
  });

  trace(logs, 'Resolved PayNote Delivery record', {
    eventId,
    deliveryId,
    deliveryDocumentId,
    sessionId,
    matchedBy,
    existingDeliveryId: existing?.deliveryId,
  });

  const identifiedHold = await identifyDeliveryTransaction({
    deliveryRecord,
    cardDetails,
    eventId,
    deliveryId,
    deps,
    logs,
  });

  await syncHoldPayNoteReference({
    deliveryRecord,
    identifiedHold,
    deliveryDocumentId,
    eventId,
    deliveryId,
    deps,
    logs,
  });

  await reportIdentificationStatusIfNeeded({
    deliveryRecord,
    sessionId,
    eventId,
    deliveryId,
    now,
    deps,
    logs,
  });

  await persistDeliveryRecord({
    deliveryRecord,
    sessionId,
    deliveryDocumentId,
    eventType,
    eventObject,
    emitted,
    now,
    deps,
  });

  const payNotePayload = getPayNoteBootstrapDocument(documentPayload);
  const payNoteSummary = getPayNoteSummaryFromDocument(payNotePayload);
  log(logs, 'info', 'PayNote Delivery updated', {
    eventId,
    deliveryId,
    deliveryDocumentId,
    deliveryStatus: deliveryRecord.deliveryStatus,
    transactionIdentificationStatus:
      deliveryRecord.transactionIdentificationStatus,
    clientDecisionStatus: deliveryRecord.clientDecisionStatus,
    deliveryName: getDeliveryNameFromDocument(documentPayload),
    payNoteName: payNoteSummary.name,
  });
};
