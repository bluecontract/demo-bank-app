import type { ContractSummary } from '../../../types/api';
import { getContractKey } from './dedupeContracts';
import { getContractLastChangeAt } from './contractTimestamps';
import {
  getItemUpdatedAt,
  isProposalItem,
  type ContractOrProposalItem,
} from './contractsAndProposals';

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

export const getItemReviewKey = (
  item: ContractOrProposalItem
): string | null => {
  if (isProposalItem(item)) {
    const key = item.deliveryId ?? item.deliverySessionId;
    return key ? `proposal:${key}` : null;
  }
  return getContractKey(item);
};

export const getItemChangeType = (
  item: ContractOrProposalItem,
  reviewedByKey: Record<string, string>
): ContractChangeType | null => {
  const key = getItemReviewKey(item);
  if (!key) {
    return null;
  }

  const updatedAt = parseTimestamp(getItemUpdatedAt(item));
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

  const createdAt = parseTimestamp(item.createdAt);
  return createdAt > reviewedAt ? 'new' : 'updated';
};
