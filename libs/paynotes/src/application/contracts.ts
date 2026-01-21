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

export const upsertContractRecord = async (input: {
  contractRepository: ContractRepository;
  document: Record<string, unknown> | undefined;
  sessionId?: string;
  documentId?: string;
  userId?: string;
  accountNumber?: string;
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
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

  const contractId = input.sessionId ?? input.documentId;
  if (!contractId) {
    return null;
  }

  const existing = await input.contractRepository.getContract(contractId);
  const status = input.status ?? existing?.status;
  const statusUpdatedAt =
    input.status && input.status !== existing?.status
      ? input.now
      : existing?.statusUpdatedAt;
  const documentName =
    getDocumentName(input.document) ?? existing?.documentName;

  await input.contractRepository.saveContract({
    contractId,
    typeBlueId: supported.typeBlueId,
    displayName: supported.displayName,
    documentName,
    sessionId: input.sessionId ?? existing?.sessionId,
    documentId: input.documentId ?? existing?.documentId,
    document: input.document ?? existing?.document,
    status,
    statusUpdatedAt,
    statusTimestamps: mergeStatusTimestamps(
      existing?.statusTimestamps,
      input.statusTimestamps
    ),
    triggerEvent: resolveEventField(existing?.triggerEvent, input.triggerEvent),
    emittedEvents: resolveEventField(
      existing?.emittedEvents,
      input.emittedEvents
    ),
    relatedTransactionIds: mergeUnique(
      existing?.relatedTransactionIds,
      input.relatedTransactionIds
    ),
    relatedHoldIds: mergeUnique(existing?.relatedHoldIds, input.relatedHoldIds),
    accountNumber: input.accountNumber ?? existing?.accountNumber,
    userId: input.userId ?? existing?.userId,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  });

  return contractId;
};
