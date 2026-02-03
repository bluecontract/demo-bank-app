export type SummaryJobType = 'contract-summary' | 'paynote-delivery-summary';

export type SummaryJob = {
  type: SummaryJobType;
  sessionId: string;
  force?: boolean;
  reason?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isSummaryJob = (value: unknown): value is SummaryJob => {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  const sessionId = value.sessionId;
  if (type !== 'contract-summary' && type !== 'paynote-delivery-summary') {
    return false;
  }
  return typeof sessionId === 'string' && sessionId.length > 0;
};
