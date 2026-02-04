import type {
  ContractSummary,
  PayNoteDeliverySummary,
} from '../../../types/api';
import {
  isProposalItem,
  type ContractOrProposalItem,
  type MergedContractItem,
} from './contractsAndProposals';

export type ProposalDecisionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'unknown';

export const getProposalDecisionStatus = (
  proposal: PayNoteDeliverySummary
): ProposalDecisionStatus => {
  const rawStatus = proposal.clientDecisionStatus?.trim().toLowerCase();
  if (!rawStatus) {
    return 'pending';
  }
  if (rawStatus === 'accepted' || rawStatus === 'rejected') {
    return rawStatus;
  }
  if (rawStatus === 'pending') {
    return 'pending';
  }
  return 'unknown';
};

export const isImportantProposal = (
  proposal: PayNoteDeliverySummary
): boolean => {
  const status = getProposalDecisionStatus(proposal);
  return status === 'pending';
};

export const isRejectedProposal = (proposal: PayNoteDeliverySummary): boolean =>
  getProposalDecisionStatus(proposal) === 'rejected';

export const isContractArchived = (contract: ContractSummary): boolean => {
  return Boolean(contract.archivedAt);
};

export const isConsentContract = (contract: ContractSummary): boolean => {
  const category = (contract as { category?: string }).category;
  return category?.toLowerCase() === 'consent';
};

export const isInboxItem = (item: ContractOrProposalItem): boolean => {
  if (isProposalItem(item)) {
    return !isRejectedProposal(item);
  }
  return !isContractArchived(item) && !isConsentContract(item);
};

export const isInboxContract = (
  item: ContractOrProposalItem
): item is MergedContractItem => !isProposalItem(item) && isInboxItem(item);
