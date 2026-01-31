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

const fetchDocumentMessages = {
  notFound: 'Failed to resolve PayNote document from MyOS',
  httpError: 'Failed to resolve PayNote document from MyOS',
  parseError: 'Failed to parse PayNote document response from MyOS',
  networkError: 'Unexpected error while resolving PayNote document',
};

type PayNoteDocumentResolution = {
  payNoteDocumentId: string;
  resolvedDocument?: Record<string, unknown>;
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
    resolvedDocument =
      toSimpleRecord(documentResult.document.document) ??
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

  return { resolution: { payNoteDocumentId, resolvedDocument } };
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
    deliveryRecord?.accountNumber ??
    getRecordString(payNoteSimple, 'payerAccountNumber');
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
      payerAccountNumber,
    userId: existingRecord?.userId ?? deliveryRecord?.userId,
    holdId: existingRecord?.holdId ?? deliveryRecord?.holdId,
    transactionId:
      existingRecord?.transactionId ?? deliveryRecord?.transactionId,
    payerAccountNumber,
    payeeAccountNumber,
    document: document ?? resolvedDocument ?? existingRecord?.document,
    transactionRequest:
      eventObject?.emitted ?? existingRecord?.transactionRequest ?? null,
    triggerEvent:
      eventObject?.triggeredBy ?? existingRecord?.triggerEvent ?? null,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
  };

  return { updatedRecord, payerAccountNumber, payeeAccountNumber };
};

export const upsertPayNoteContract = async (input: {
  updatedRecord: PayNoteRecord;
  sessionId: string;
  payNoteDocumentId: string;
  eventType?: string;
  triggerEvent?: unknown;
  emittedEvents?: WebhookEmittedEvent[];
  now: string;
  deps: HandleWebhookEventDependencies;
  relatedHoldIds?: string[];
  relatedTransactionIds?: string[];
}): Promise<void> => {
  const {
    updatedRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
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
    document: updatedRecord.document,
    eventType,
    triggerEvent,
    emittedEvents,
    relatedHoldIds,
    relatedTransactionIds,
    now,
  });
};

export const persistPayNoteRecord = async (input: {
  updatedRecord: PayNoteRecord;
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
    sessionId,
    payNoteDocumentId,
    eventType,
    eventObject,
    emittedEvents,
    now,
    deps,
  } = input;

  await deps.payNoteRepository.savePayNote(updatedRecord);
  await upsertPayNoteContract({
    updatedRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents,
    now,
    deps,
  });
};
