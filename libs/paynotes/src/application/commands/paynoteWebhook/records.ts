import type { PayNoteDeliveryRecord, PayNoteRecord } from '../../ports';
import { blue } from '../../../blue';
import { upsertPayNoteContractRecord } from '../payNoteContractUtils';
import { mergeSessionIds } from '../payNoteSessionUtils';
import type { LogEntry } from '../../ports';
import { logMyOsFetchError } from './myosErrors';
import { logAndReturn, trace } from './logging';
import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventResult,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import { getRecordString, parsePayNoteDocument, toSimpleRecord } from './utils';
import { resolvePayNoteCustomerChannelKey } from './customerChannel';

const fetchDocumentMessages = {
  notFound: 'Failed to resolve PayNote document from MyOS',
  httpError: 'Failed to resolve PayNote document from MyOS',
  parseError: 'Failed to parse PayNote document response from MyOS',
  networkError: 'Unexpected error while resolving PayNote document',
};

type PayNoteDocumentResolution = {
  payNoteDocumentId: string;
  resolvedDocument?: Record<string, unknown>;
  resolvedDocumentRaw?: unknown;
};

export const resolvePayNoteDocumentId = async (input: {
  eventId: string;
  sessionId: string;
  payNoteRecord: PayNoteRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<
  | { resolution: PayNoteDocumentResolution }
  | { result: HandleWebhookEventResult }
> => {
  const { eventId, sessionId, payNoteRecord, deps, logs } = input;
  let payNoteDocumentId = payNoteRecord?.payNoteDocumentId;
  let resolvedDocument: Record<string, unknown> | undefined;
  let resolvedDocumentRaw: unknown;

  if (!payNoteDocumentId) {
    const documentResult = await deps.myOsClient.fetchDocument(sessionId);
    if (documentResult.kind !== 'success') {
      logMyOsFetchError(
        documentResult,
        logs,
        { sessionId },
        fetchDocumentMessages
      );
      return {
        result: { note: 'Failed to resolve PayNote document id', logs },
      };
    }

    payNoteDocumentId = documentResult.document.documentId;
    resolvedDocumentRaw = documentResult.document.document;
    resolvedDocument =
      toSimpleRecord(resolvedDocumentRaw) ??
      (documentResult.document.document as Record<string, unknown> | undefined);

    trace(logs, 'Resolved PayNote document id from MyOS', {
      eventId,
      sessionId,
      payNoteDocumentId,
    });
  }

  if (!payNoteDocumentId) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote document id missing after resolution',
      { eventId, sessionId }
    );
    return { result: { note, logs } };
  }

  return {
    resolution: { payNoteDocumentId, resolvedDocument, resolvedDocumentRaw },
  };
};

export const resolveDeliveryRecord = async (
  existingRecord: PayNoteRecord | null,
  payNoteDocumentId: string,
  deps: HandleWebhookEventDependencies
): Promise<PayNoteDeliveryRecord | null> => {
  if (existingRecord?.deliveryId != null) {
    return deps.payNoteDeliveryRepository.getDelivery(
      existingRecord.deliveryId
    );
  }

  return deps.payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId(
    payNoteDocumentId
  );
};

export const resolvePayNoteParsed = (input: {
  document: Record<string, unknown>;
  resolvedDocument?: Record<string, unknown>;
  eventId: string;
  sessionId: string;
  logs: LogEntry[];
}):
  | { parsed: NonNullable<ReturnType<typeof parsePayNoteDocument>> }
  | { result: HandleWebhookEventResult } => {
  const { document, resolvedDocument, eventId, sessionId, logs } = input;
  const payNoteParsed =
    parsePayNoteDocument(document) ??
    (resolvedDocument ? parsePayNoteDocument(resolvedDocument) : null);

  if (!payNoteParsed) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote webhook document is not a PayNote',
      { eventId, sessionId }
    );
    return { result: { note, logs } };
  }

  return { parsed: payNoteParsed };
};

export const buildPayNoteRecord = (input: {
  payNoteDocumentId: string;
  sessionId: string;
  existingRecord: PayNoteRecord | null;
  deliveryRecord: PayNoteDeliveryRecord | null;
  bootstrapMerchantId?: string;
  bootstrapAccountNumber?: string;
  bootstrapUserId?: string;
  document: Record<string, unknown>;
  resolvedDocument?: Record<string, unknown>;
  eventObject?: WebhookEventObject;
  payNoteParsed: NonNullable<ReturnType<typeof parsePayNoteDocument>>;
  now: string;
}): {
  updatedRecord: PayNoteRecord;
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
} => {
  const {
    payNoteDocumentId,
    sessionId,
    existingRecord,
    deliveryRecord,
    bootstrapMerchantId,
    bootstrapAccountNumber,
    bootstrapUserId,
    document,
    resolvedDocument,
    eventObject,
    payNoteParsed,
    now,
  } = input;

  const payNoteSimple = blue.nodeToJson(payNoteParsed.node, 'simple') as
    | Record<string, unknown>
    | undefined;
  const payerAccountNumber =
    existingRecord?.payerAccountNumber ??
    existingRecord?.accountNumber ??
    deliveryRecord?.accountNumber ??
    getRecordString(payNoteSimple, 'payerAccountNumber') ??
    getRecordString(payNoteSimple, 'accountNumber');
  const payeeAccountNumber =
    existingRecord?.payeeAccountNumber ??
    getRecordString(payNoteSimple, 'payeeAccountNumber');

  const updatedRecord: PayNoteRecord = {
    payNoteDocumentId,
    sessionIds: mergeSessionIds(existingRecord?.sessionIds, sessionId),
    deliveryId: existingRecord?.deliveryId ?? deliveryRecord?.deliveryId,
    accountNumber:
      existingRecord?.accountNumber ??
      deliveryRecord?.accountNumber ??
      bootstrapAccountNumber ??
      payerAccountNumber,
    userId: existingRecord?.userId ?? deliveryRecord?.userId ?? bootstrapUserId,
    holdId: existingRecord?.holdId ?? deliveryRecord?.holdId,
    transactionId:
      existingRecord?.transactionId ?? deliveryRecord?.transactionId,
    merchantId:
      existingRecord?.merchantId ??
      deliveryRecord?.merchantId ??
      bootstrapMerchantId,
    lastCaptureLockEventId: existingRecord?.lastCaptureLockEventId,
    lastCaptureUnlockEventId: existingRecord?.lastCaptureUnlockEventId,
    payerAccountNumber,
    payeeAccountNumber,
    document: document ?? resolvedDocument ?? existingRecord?.document,
    transactionRequest:
      eventObject?.emitted ?? existingRecord?.transactionRequest ?? null,
    triggerEvent:
      eventObject?.triggeredBy ?? existingRecord?.triggerEvent ?? null,
    pendingMandateChargeAttempts: existingRecord?.pendingMandateChargeAttempts,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
  };

  return { updatedRecord, payerAccountNumber, payeeAccountNumber };
};

export const upsertPayNoteContract = async (input: {
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  sessionId: string;
  payNoteDocumentId: string;
  eventType?: string;
  eventEpoch?: number;
  triggerEvent?: unknown;
  emittedEvents?: WebhookEmittedEvent[];
  now: string;
  deps: HandleWebhookEventDependencies;
  relatedHoldIds?: string[];
  relatedTransactionIds?: string[];
}): Promise<void> => {
  const {
    updatedRecord,
    deliveryRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
    eventEpoch,
    triggerEvent,
    emittedEvents,
    now,
    deps,
    relatedHoldIds,
    relatedTransactionIds,
  } = input;

  await upsertPayNoteContractRecord({
    contractRepository: deps.contractRepository,
    updatedRecord,
    sessionId,
    documentId: payNoteDocumentId,
    customerChannelKey: resolvePayNoteCustomerChannelKey({
      updatedRecord,
      deliveryRecord,
    }),
    document: updatedRecord.document,
    eventType,
    eventEpoch,
    triggerEvent,
    emittedEvents,
    relatedHoldIds,
    relatedTransactionIds,
    now,
  });
};

export const persistPayNoteRecord = async (input: {
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  documentForStorage?: Record<string, unknown>;
  sessionId: string;
  payNoteDocumentId: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  now: string;
  deps: HandleWebhookEventDependencies;
}): Promise<void> => {
  const {
    updatedRecord,
    deliveryRecord,
    documentForStorage,
    sessionId,
    payNoteDocumentId,
    eventType,
    eventObject,
    emittedEvents,
    now,
    deps,
  } = input;

  const persistedRecord = documentForStorage
    ? { ...updatedRecord, document: documentForStorage }
    : updatedRecord;

  await deps.payNoteRepository.savePayNote(persistedRecord);
  await upsertPayNoteContract({
    updatedRecord: persistedRecord,
    deliveryRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
    eventEpoch: eventObject?.epoch,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents,
    now,
    deps,
  });
};
