import type { ContractSummary } from '../../../types/api';

export const getContractLastChangeAt = (
  contract: ContractSummary
): string | undefined =>
  contract.summarySourceUpdatedAt ??
  contract.summaryUpdatedAt ??
  contract.updatedAt;
