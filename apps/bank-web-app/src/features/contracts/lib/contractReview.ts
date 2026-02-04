import type { ContractSummary } from '../../../types/api';
import { getContractKey } from './dedupeContracts';
import { getContractLastChangeAt } from './contractTimestamps';

export type ContractChangeType = 'new' | 'updated';

const parseTimestamp = (value?: string | null) => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getContractChangeType = (
  contract: ContractSummary,
  reviewedByKey: Record<string, string>
): ContractChangeType | null => {
  const key = getContractKey(contract);
  if (!key) {
    return null;
  }

  const updatedAt = parseTimestamp(getContractLastChangeAt(contract));
  if (!updatedAt) {
    return null;
  }

  const reviewedAt = parseTimestamp(reviewedByKey[key]);
  if (!reviewedAt) {
    return 'new';
  }

  if (updatedAt <= reviewedAt) {
    return null;
  }

  const createdAt = parseTimestamp(contract.createdAt);
  return createdAt > reviewedAt ? 'new' : 'updated';
};
