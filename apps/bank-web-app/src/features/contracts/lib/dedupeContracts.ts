import type { ContractSummary } from '../../../types/api';

export const getContractKey = (contract: ContractSummary) =>
  contract.documentId ?? contract.contractId;

const parseTimestamp = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const pickPreferredContract = (
  current: ContractSummary,
  candidate: ContractSummary
) => {
  const currentHasSession = Boolean(current.sessionId);
  const candidateHasSession = Boolean(candidate.sessionId);

  if (currentHasSession !== candidateHasSession) {
    return candidateHasSession ? candidate : current;
  }

  const currentUpdated = parseTimestamp(current.updatedAt);
  const candidateUpdated = parseTimestamp(candidate.updatedAt);

  if (currentUpdated !== candidateUpdated) {
    return candidateUpdated > currentUpdated ? candidate : current;
  }

  const currentCreated = parseTimestamp(current.createdAt);
  const candidateCreated = parseTimestamp(candidate.createdAt);

  if (currentCreated !== candidateCreated) {
    return candidateCreated > currentCreated ? candidate : current;
  }

  return current;
};

export const dedupeContracts = (contracts: ContractSummary[]) => {
  const deduped = new Map<string, ContractSummary>();

  for (const contract of contracts) {
    const key = getContractKey(contract);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, contract);
      continue;
    }

    deduped.set(key, pickPreferredContract(existing, contract));
  }

  return Array.from(deduped.values());
};
