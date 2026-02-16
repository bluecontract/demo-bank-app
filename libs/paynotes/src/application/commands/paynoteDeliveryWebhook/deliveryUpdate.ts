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
import { mergeSessionIds } from '../payNoteSessionUtils';
import { blue } from '../../../blue';
import { toBlueNode } from '../webhookUtils';
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
import { getConcretePaymentMandateBootstrapRequest } from './paymentMandate';
import { isRecord } from '../typeGuards';

const persistDeliveryRecord = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  sessionId?: string;
  deliveryDocumentId?: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  emitted: unknown[];
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<PayNoteDeliveryRecord> => {
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

  await upsertContractRecord({
    contractRepository: deps.contractRepository,
    document: deliveryRecord.deliveryDocument,
    sessionId,
    documentId: deliveryRecord.deliveryDocumentId ?? deliveryDocumentId,
    customerChannelKey: 'payNoteDeliverer',
    eventType,
    eventEpoch: eventObject?.epoch,
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

  const resolvedDeliveryDocumentId =
    deliveryRecord.deliveryDocumentId ?? deliveryDocumentId;
  const contract = resolvedDeliveryDocumentId
    ? await deps.contractRepository.getContractByDocumentId(
        resolvedDeliveryDocumentId
      )
    : null;
  const canonicalSessionId = contract?.sessionId;
  const deliverySessionIds = mergeSessionIds(
    deliveryRecord.deliverySessionIds ??
      (deliveryRecord.deliverySessionId
        ? [deliveryRecord.deliverySessionId]
        : undefined),
    canonicalSessionId
  );
  const nextDeliveryRecord = canonicalSessionId
    ? {
        ...deliveryRecord,
        deliverySessionId: canonicalSessionId,
        deliverySessionIds,
      }
    : deliveryRecord;

  await deps.payNoteDeliveryRepository.saveDelivery(nextDeliveryRecord);
  return nextDeliveryRecord;
};

const getPayNoteBootstrapDocument = (
  documentPayload: Record<string, unknown>
): Record<string, unknown> | null => {
  const request = toSimpleRecord(documentPayload.payNoteBootstrapRequest);
  return toSimpleRecord(request?.document);
};

const resolvePayNoteProposalDocument = (
  deliveryRecord: PayNoteDeliveryRecord
): Record<string, unknown> | null => {
  const deliveryDocument = toSimpleRecord(deliveryRecord.deliveryDocument);
  const bootstrapRequest = toSimpleRecord(
    deliveryDocument?.payNoteBootstrapRequest
  );

  return (
    toSimpleRecord(bootstrapRequest?.document) ??
    toSimpleRecord(deliveryDocument?.payNote) ??
    toSimpleRecord(deliveryRecord.payNoteDocument) ??
    null
  );
};

const extractBootstrapSessionId = (response: {
  body?: unknown;
}): string | undefined => {
  const body = response.body as { sessionId?: unknown } | undefined;
  return typeof body?.sessionId === 'string' ? body.sessionId : undefined;
};

const resolveBootstrapFailureReason = (input: {
  status: number;
  body?: unknown;
}): string => {
  const { status, body } = input;
  const bodyRecord = toSimpleRecord(body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `Payment Mandate bootstrap failed: ${detail}`
    : `Payment Mandate bootstrap failed with status ${status}.`;
};

const normalizeChannelBindings = (
  bindings: unknown
): Record<string, { email?: string; accountId?: string }> => {
  if (!bindings || typeof bindings !== 'object') {
    return {};
  }

  const output: Record<string, { email?: string; accountId?: string }> = {};
  Object.entries(bindings as Record<string, unknown>).forEach(
    ([key, value]) => {
      if (!key) {
        return;
      }
      const binding = toSimpleRecord(value);
      if (!binding) {
        return;
      }
      const accountId = getString(binding.accountId);
      const email = getString(binding.email);
      if (accountId) {
        output[key] = { accountId };
      } else if (email) {
        output[key] = { email };
      }
    }
  );

  return output;
};

const normalizeBootstrapDocument = (
  document: Record<string, unknown>
): Record<string, unknown> => {
  const node = toBlueNode(document);
  if (!node) {
    return document;
  }
  const restored = blue.restoreInlineTypes(node);
  const normalized = blue.nodeToJson(restored, 'original');
  return normalized &&
    typeof normalized === 'object' &&
    !Array.isArray(normalized)
    ? (normalized as Record<string, unknown>)
    : document;
};

const maybeBootstrapDeliveryPaymentMandate = async (input: {
  eventId: string;
  deliveryRecord: PayNoteDeliveryRecord;
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<PayNoteDeliveryRecord> => {
  const { eventId, deliveryRecord, now, deps, logs } = input;

  if (deliveryRecord.transactionIdentificationStatus !== 'identified') {
    return deliveryRecord;
  }

  const deliveryDocument = toSimpleRecord(deliveryRecord.deliveryDocument);
  const mandateBootstrapRequest =
    getConcretePaymentMandateBootstrapRequest(deliveryDocument);
  if (!mandateBootstrapRequest) {
    if (deliveryRecord.paymentMandateStatus !== 'not_required') {
      return {
        ...deliveryRecord,
        paymentMandateStatus: 'not_required',
        updatedAt: now,
      };
    }
    return deliveryRecord;
  }

  if (
    deliveryRecord.paymentMandateDocumentId ||
    deliveryRecord.paymentMandateBootstrapSessionId ||
    deliveryRecord.paymentMandateStatus === 'attached'
  ) {
    return deliveryRecord;
  }

  const mandateDocument = isRecord(mandateBootstrapRequest.document)
    ? (mandateBootstrapRequest.document as Record<string, unknown>)
    : null;
  if (!mandateDocument) {
    log(
      logs,
      'warn',
      'Delivery payment mandate bootstrap skipped (invalid payload)',
      {
        eventId,
        deliveryId: deliveryRecord.deliveryId,
      }
    );
    return {
      ...deliveryRecord,
      paymentMandateStatus: 'failed',
      updatedAt: now,
    };
  }

  const credentials = await deps.myOsClient.getCredentials();
  const requestBindings = normalizeChannelBindings(
    mandateBootstrapRequest.channelBindings
  );
  const guarantorAccountId = getString(
    toSimpleRecord(requestBindings.guarantorChannel)?.accountId
  );
  if (guarantorAccountId && guarantorAccountId !== credentials.accountId) {
    log(
      logs,
      'warn',
      'Delivery payment mandate bootstrap rejected (guarantor conflict)',
      {
        eventId,
        deliveryId: deliveryRecord.deliveryId,
        guarantorAccountId,
        bankAccountId: credentials.accountId,
      }
    );
    return {
      ...deliveryRecord,
      paymentMandateStatus: 'failed',
      updatedAt: now,
    };
  }

  const channelBindings = {
    ...requestBindings,
    guarantorChannel: { accountId: credentials.accountId },
  };
  const mandateBootstrapIdempotencyKey = [
    'paynote-delivery-payment-mandate-bootstrap',
    eventId,
    deliveryRecord.deliveryId,
  ].join(':');
  const bootstrapResponse = await deps.myOsClient.bootstrapDocument({
    credentials,
    idempotencyKey: mandateBootstrapIdempotencyKey,
    payload: {
      channelBindings,
      document: normalizeBootstrapDocument(mandateDocument),
    },
  });
  if (!bootstrapResponse.ok) {
    const reason = resolveBootstrapFailureReason({
      status: bootstrapResponse.status,
      body: bootstrapResponse.body,
    });
    log(logs, 'warn', 'Delivery payment mandate bootstrap failed', {
      eventId,
      deliveryId: deliveryRecord.deliveryId,
      reason,
    });
    if (deliveryRecord.deliverySessionId) {
      await deps.myOsClient.runDocumentOperation({
        credentials,
        sessionId: deliveryRecord.deliverySessionId,
        operation: 'reportDeliveryError',
        payload: reason,
      });
    }
    return {
      ...deliveryRecord,
      paymentMandateStatus: 'failed',
      updatedAt: now,
    };
  }

  const bootstrapSessionId = extractBootstrapSessionId(bootstrapResponse);
  if (!bootstrapSessionId) {
    return {
      ...deliveryRecord,
      paymentMandateStatus: 'failed',
      updatedAt: now,
    };
  }

  await deps.bootstrapContextRepository.saveContext({
    bootstrapSessionId,
    ...(getString(mandateDocument.granterId)
      ? { merchantId: getString(mandateDocument.granterId) }
      : {}),
    ...(deliveryRecord.deliverySessionId
      ? { requestingSessionId: deliveryRecord.deliverySessionId }
      : {}),
    ...(getString(mandateBootstrapRequest.requestId)
      ? { requestId: getString(mandateBootstrapRequest.requestId) }
      : {}),
    createdAt: now,
  });

  if (deps.consumePendingBootstrapEvents) {
    try {
      await deps.consumePendingBootstrapEvents(bootstrapSessionId);
    } catch (error) {
      log(
        logs,
        'error',
        'Failed consuming pending bootstrap events for delivery payment mandate bootstrap',
        {
          eventId,
          deliveryId: deliveryRecord.deliveryId,
          bootstrapSessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  log(logs, 'info', 'Delivery payment mandate bootstrap requested', {
    eventId,
    deliveryId: deliveryRecord.deliveryId,
    bootstrapSessionId,
  });

  return {
    ...deliveryRecord,
    paymentMandateBootstrapSessionId: bootstrapSessionId,
    paymentMandateStatus: 'pending',
    updatedAt: now,
  };
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
  const canonicalDeliveryContract = deliveryDocumentId
    ? await deps.contractRepository.getContractByDocumentId(deliveryDocumentId)
    : null;
  const canonicalDeliverySessionId = canonicalDeliveryContract?.sessionId;
  if (
    canonicalDeliverySessionId &&
    sessionId &&
    canonicalDeliverySessionId !== sessionId
  ) {
    log(logs, 'info', 'Delivery event ignored (non-canonical session)', {
      eventId,
      deliveryId,
      sessionId,
      canonicalDeliverySessionId,
    });
    return;
  }

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
    eventType,
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

  const persistedDeliveryRecord = await persistDeliveryRecord({
    deliveryRecord,
    sessionId,
    deliveryDocumentId,
    eventType,
    eventObject,
    emitted,
    now,
    deps,
  });

  const deliveryWithMandateStage = await maybeBootstrapDeliveryPaymentMandate({
    eventId,
    deliveryRecord: persistedDeliveryRecord,
    now,
    deps,
    logs,
  });
  const effectiveDeliveryRecord =
    deliveryWithMandateStage !== persistedDeliveryRecord
      ? await persistDeliveryRecord({
          deliveryRecord: deliveryWithMandateStage,
          sessionId,
          deliveryDocumentId,
          eventType,
          eventObject,
          emitted,
          now,
          deps,
        })
      : persistedDeliveryRecord;

  const enqueuePayNoteDeliverySummary = deps.enqueuePayNoteDeliverySummary;
  const canonicalSessionForSummary = effectiveDeliveryRecord.deliverySessionId;
  const shouldEnqueuePayNoteDeliverySummary =
    enqueuePayNoteDeliverySummary &&
    canonicalSessionForSummary &&
    sessionId === canonicalSessionForSummary &&
    (eventType === 'DOCUMENT_CREATED' ||
      eventType === 'DOCUMENT_EPOCH_ADVANCED') &&
    effectiveDeliveryRecord.transactionIdentificationStatus === 'identified' &&
    Boolean(resolvePayNoteProposalDocument(effectiveDeliveryRecord));

  if (shouldEnqueuePayNoteDeliverySummary) {
    await enqueuePayNoteDeliverySummary({
      sessionId: canonicalSessionForSummary,
      reason: 'delivery-update',
    });
    trace(logs, 'Enqueued PayNote Delivery summary', {
      eventId,
      deliveryId,
      sessionId: canonicalSessionForSummary,
    });
  }

  const payNotePayload = getPayNoteBootstrapDocument(documentPayload);
  const payNoteSummary = getPayNoteSummaryFromDocument(payNotePayload);
  log(logs, 'info', 'PayNote Delivery updated', {
    eventId,
    deliveryId,
    deliveryDocumentId,
    deliveryStatus: effectiveDeliveryRecord.deliveryStatus,
    transactionIdentificationStatus:
      effectiveDeliveryRecord.transactionIdentificationStatus,
    clientDecisionStatus: effectiveDeliveryRecord.clientDecisionStatus,
    paymentMandateStatus: effectiveDeliveryRecord.paymentMandateStatus,
    deliveryName: getDeliveryNameFromDocument(documentPayload),
    payNoteName: payNoteSummary.name,
  });
};
