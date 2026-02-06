import type {
  ContractRepository,
  ContractStatusTimestamps,
} from '@demo-bank-app/contracts';
import { getSupportedContractForDocument } from '@demo-bank-app/shared-bank-api-contract';

const mergeUnique = (existing?: string[], incoming?: string[]) => {
  const set = new Set<string>(existing ?? []);
  (incoming ?? []).forEach(value => {
    if (value) {
      set.add(value);
    }
  });
  return set.size ? Array.from(set) : undefined;
};

const mergeStatusTimestamps = (
  existing?: ContractStatusTimestamps,
  incoming?: ContractStatusTimestamps
) => {
  if (!existing && !incoming) {
    return undefined;
  }
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
};

const resolveEventField = <T>(
  existing: T | undefined,
  incoming: T | undefined
) => (incoming !== undefined ? incoming : existing);

const getDocumentName = (document?: Record<string, unknown>) => {
  if (!document) {
    return undefined;
  }

  const name = document.name;
  if (typeof name !== 'string') {
    return undefined;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed : undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const areJsonValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) =>
      areJsonValuesEqual(value, right[index])
    );
  }
  if (isPlainObject(left)) {
    if (!isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      key =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areJsonValuesEqual(left[key], right[key])
    );
  }
  return false;
};

export const upsertContractRecord = async (input: {
  contractRepository: ContractRepository;
  document: Record<string, unknown> | undefined;
  sessionId?: string;
  documentId?: string;
  eventType?: string;
  userId?: string;
  accountNumber?: string;
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
  merchantId?: string;
  status?: string;
  statusTimestamps?: ContractStatusTimestamps;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  now: string;
}) => {
  if (!input.document) {
    return null;
  }

  const supported = getSupportedContractForDocument(input.document);
  if (!supported) {
    return null;
  }

  const existingByDocumentId = input.documentId
    ? await input.contractRepository.getContractByDocumentId(input.documentId)
    : null;
  if (
    existingByDocumentId &&
    input.sessionId &&
    existingByDocumentId.sessionId &&
    input.sessionId !== existingByDocumentId.sessionId
  ) {
    return existingByDocumentId.contractId;
  }

  const contractId =
    existingByDocumentId?.contractId ?? input.sessionId ?? input.documentId;
  if (!contractId) {
    return null;
  }

  const existing =
    existingByDocumentId ??
    (await input.contractRepository.getContract(contractId));
  if (!existing && input.eventType === 'DOCUMENT_EPOCH_ADVANCED') {
    return null;
  }
  const status = input.status ?? existing?.status;
  const statusUpdatedAt =
    input.status && input.status !== existing?.status
      ? input.now
      : existing?.statusUpdatedAt;
  const nextStatusTimestamps = mergeStatusTimestamps(
    existing?.statusTimestamps,
    input.statusTimestamps
  );
  const documentName =
    getDocumentName(input.document) ?? existing?.documentName;
  const nextSessionId = input.sessionId ?? existing?.sessionId;
  const nextDocumentId = input.documentId ?? existing?.documentId;
  const nextDocument = input.document ?? existing?.document;
  const nextTriggerEvent = resolveEventField(
    existing?.triggerEvent,
    input.triggerEvent
  );
  const nextEmittedEvents = resolveEventField(
    existing?.emittedEvents,
    input.emittedEvents
  );
  const nextRelatedTransactionIds = mergeUnique(
    existing?.relatedTransactionIds,
    input.relatedTransactionIds
  );
  const nextRelatedHoldIds = mergeUnique(
    existing?.relatedHoldIds,
    input.relatedHoldIds
  );
  const nextAccountNumber = input.accountNumber ?? existing?.accountNumber;
  const nextUserId = input.userId ?? existing?.userId;
  const nextMerchantId = input.merchantId ?? existing?.merchantId;

  const summaryInputsChanged =
    !areJsonValuesEqual(nextDocument, existing?.document) ||
    nextDocumentId !== existing?.documentId ||
    nextSessionId !== existing?.sessionId ||
    status !== existing?.status ||
    statusUpdatedAt !== existing?.statusUpdatedAt ||
    !areJsonValuesEqual(nextStatusTimestamps, existing?.statusTimestamps) ||
    !areJsonValuesEqual(nextTriggerEvent, existing?.triggerEvent) ||
    !areJsonValuesEqual(nextEmittedEvents, existing?.emittedEvents);
  const updatedAt =
    existing?.updatedAt && !summaryInputsChanged
      ? existing.updatedAt
      : input.now;

  await input.contractRepository.saveContract({
    contractId,
    typeBlueId: supported.typeBlueId,
    displayName: supported.displayName,
    documentName,
    sessionId: nextSessionId,
    documentId: nextDocumentId,
    document: nextDocument,
    status,
    statusUpdatedAt,
    statusTimestamps: nextStatusTimestamps,
    triggerEvent: nextTriggerEvent,
    emittedEvents: nextEmittedEvents,
    relatedTransactionIds: nextRelatedTransactionIds,
    relatedHoldIds: nextRelatedHoldIds,
    accountNumber: nextAccountNumber,
    userId: nextUserId,
    merchantId: nextMerchantId,
    summary: existing?.summary,
    summaryUpdatedAt: existing?.summaryUpdatedAt,
    summarySourceUpdatedAt: existing?.summarySourceUpdatedAt,
    summaryInputBlueId: existing?.summaryInputBlueId,
    summaryModel: existing?.summaryModel,
    summaryError: existing?.summaryError,
    summaryDocument: existing?.summaryDocument,
    summaryDocumentName: existing?.summaryDocumentName,
    summaryStatus: existing?.summaryStatus,
    summaryStatusUpdatedAt: existing?.summaryStatusUpdatedAt,
    summaryStatusTimestamps: existing?.summaryStatusTimestamps,
    summaryTriggerEvent: existing?.summaryTriggerEvent,
    summaryEmittedEvents: existing?.summaryEmittedEvents,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt,
  });

  return contractId;
};
