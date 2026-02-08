import type { CardTransactionDetails } from '@demo-bank-app/banking';
import type { PayNoteDeliveryRecord } from '../../ports';
import {
  getDeliveryStatusFromDocument,
  getSynchronySessionIdFromDocument,
} from '../../payNoteDelivery/blueUtils';
import { mergeSessionIds } from '../payNoteSessionUtils';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';

export type DeliveryMatchType =
  | 'documentId'
  | 'sessionId'
  | 'cardDetails'
  | 'new';

const normalizeDeliverySessionIds = (
  record?: PayNoteDeliveryRecord | null
): string[] | undefined => {
  if (!record) {
    return undefined;
  }
  if (record.deliverySessionIds?.length) {
    return record.deliverySessionIds;
  }
  return record.deliverySessionId ? [record.deliverySessionId] : undefined;
};

export const buildOperationSessionIds = (
  primary?: string,
  sessionIds?: string[],
  fallback?: string
): string[] => {
  const unique = new Set<string>();
  if (primary) {
    unique.add(primary);
  }
  (sessionIds ?? []).forEach(id => {
    if (id) {
      unique.add(id);
    }
  });
  if (fallback) {
    unique.add(fallback);
  }
  return Array.from(unique);
};

export const resolveExistingDelivery = async (input: {
  deliveryDocumentId?: string;
  sessionId?: string;
  cardDetails: CardTransactionDetails;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<{
  existing: PayNoteDeliveryRecord | null;
  matchedBy: DeliveryMatchType;
}> => {
  const { deliveryDocumentId, sessionId, cardDetails, deps } = input;
  let existing: PayNoteDeliveryRecord | null = null;
  let matchedBy: DeliveryMatchType = 'new';

  if (deliveryDocumentId) {
    existing =
      (await deps.payNoteDeliveryRepository.getDeliveryByDocumentId(
        deliveryDocumentId
      )) ?? null;
    if (existing) {
      matchedBy = 'documentId';
    }
  }

  if (!existing && sessionId) {
    existing =
      (await deps.payNoteDeliveryRepository.getDeliveryBySessionId(
        sessionId
      )) ?? null;
    if (existing) {
      matchedBy = 'sessionId';
    }
  }

  if (!existing) {
    existing =
      (await deps.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails(
        cardDetails
      )) ?? null;
    if (existing) {
      matchedBy = 'cardDetails';
    }
  }

  return { existing, matchedBy };
};

export const buildDeliveryRecord = (input: {
  existing: PayNoteDeliveryRecord | null;
  deliveryId: string;
  cardDetails: CardTransactionDetails;
  documentPayload: Record<string, unknown>;
  eventObject?: { created?: string };
  deliveryDocumentId?: string;
  sessionId?: string;
  now: string;
}): PayNoteDeliveryRecord => {
  const {
    existing,
    deliveryId,
    cardDetails,
    documentPayload,
    eventObject,
    deliveryDocumentId,
    sessionId,
    now,
  } = input;

  const {
    deliveryStatus,
    transactionIdentificationStatus,
    clientDecisionStatus,
  } = getDeliveryStatusFromDocument(documentPayload);

  const synchronySessionId =
    existing?.synchronySessionId ??
    getSynchronySessionIdFromDocument(documentPayload);

  const deliverySessionIds = mergeSessionIds(
    normalizeDeliverySessionIds(existing),
    sessionId
  );
  const resolvedDeliverySessionId =
    existing?.deliverySessionId ?? sessionId ?? deliverySessionIds?.[0];

  const deliveryRecord: PayNoteDeliveryRecord = {
    ...(existing ?? {
      deliveryId,
      createdAt: now,
      updatedAt: now,
    }),
    deliveryId,
    deliveryDocumentId: deliveryDocumentId ?? existing?.deliveryDocumentId,
    deliverySessionId: resolvedDeliverySessionId,
    deliverySessionIds,
    synchronySessionId,
    cardTransactionDetails: cardDetails,
    cardTransactionDetailsKey: deliveryId,
    deliveryDocument: documentPayload,
    deliveryUpdatedAt: eventObject?.created ?? now,
    deliveryStatus: deliveryStatus ?? existing?.deliveryStatus,
    transactionIdentificationStatus:
      transactionIdentificationStatus ??
      existing?.transactionIdentificationStatus,
    clientDecisionStatus:
      clientDecisionStatus ?? existing?.clientDecisionStatus,
    payNoteDocumentId: existing?.payNoteDocumentId,
    payNoteSessionIds: existing?.payNoteSessionIds,
    payNoteBootstrapSessionId: existing?.payNoteBootstrapSessionId,
    payNoteDocument: existing?.payNoteDocument,
    payNoteUpdatedAt: existing?.payNoteUpdatedAt,
    identificationReportedAt: existing?.identificationReportedAt,
    decisionRecordedAt: existing?.decisionRecordedAt,
    payNoteBootstrapRequestedAt: existing?.payNoteBootstrapRequestedAt,
    accountNumber: existing?.accountNumber,
    userId: existing?.userId,
    holdId: existing?.holdId,
    transactionId: existing?.transactionId,
    merchantId: existing?.merchantId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (
    deliveryRecord.userId &&
    (!deliveryRecord.transactionIdentificationStatus ||
      deliveryRecord.transactionIdentificationStatus === 'pending')
  ) {
    deliveryRecord.transactionIdentificationStatus = 'identified';
  }

  return deliveryRecord;
};
