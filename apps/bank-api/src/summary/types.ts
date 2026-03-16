export type SummaryJobType = 'contract-summary' | 'paynote-delivery-summary';

export type ContractSummaryJob = {
  type: 'contract-summary';
  messageVersion?: 1;
  contractId: string;
  documentId: string;
  summaryInputKey: string;
  sourceUpdatedAt: string;
  sourceEpoch?: number;
  attempt?: number;
  force?: boolean;
  reason?: string;
};

export type PayNoteDeliverySummaryJob = {
  type: 'paynote-delivery-summary';
  sessionId: string;
  force?: boolean;
  reason?: string;
};

export type SummaryJob = ContractSummaryJob | PayNoteDeliverySummaryJob;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isSummaryJob = (value: unknown): value is SummaryJob => {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  if (type === 'paynote-delivery-summary') {
    return typeof value.sessionId === 'string' && value.sessionId.length > 0;
  }

  if (type !== 'contract-summary') {
    return false;
  }

  return (
    typeof value.contractId === 'string' &&
    value.contractId.length > 0 &&
    typeof value.documentId === 'string' &&
    value.documentId.length > 0 &&
    typeof value.summaryInputKey === 'string' &&
    value.summaryInputKey.length > 0 &&
    typeof value.sourceUpdatedAt === 'string' &&
    value.sourceUpdatedAt.length > 0
  );
};
