import type { ContractRepository } from '@demo-bank-app/contracts';
import type { PayNoteRecord } from '../ports';
import { upsertContractRecord } from '../contracts';

export const upsertPayNoteContractRecord = async (input: {
  contractRepository: ContractRepository;
  updatedRecord: PayNoteRecord;
  sessionId: string;
  documentId: string;
  document?: Record<string, unknown>;
  eventType?: string;
  eventEpoch?: number;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  relatedHoldIds?: string[];
  relatedTransactionIds?: string[];
  now: string;
}): Promise<void> => {
  const {
    contractRepository,
    updatedRecord,
    sessionId,
    documentId,
    document,
    eventType,
    eventEpoch,
    triggerEvent,
    emittedEvents,
    relatedHoldIds,
    relatedTransactionIds,
    now,
  } = input;

  await upsertContractRecord({
    contractRepository,
    document: document ?? updatedRecord.document,
    sessionId,
    documentId,
    eventType,
    eventEpoch,
    userId: updatedRecord.userId,
    accountNumber: updatedRecord.accountNumber,
    triggerEvent,
    emittedEvents,
    relatedTransactionIds:
      relatedTransactionIds ??
      (updatedRecord.transactionId ? [updatedRecord.transactionId] : undefined),
    relatedHoldIds:
      relatedHoldIds ??
      (updatedRecord.holdId ? [updatedRecord.holdId] : undefined),
    merchantId: updatedRecord.merchantId,
    status: updatedRecord.transactionId
      ? 'processed'
      : updatedRecord.holdId
      ? 'reserved'
      : undefined,
    now,
  });
};
