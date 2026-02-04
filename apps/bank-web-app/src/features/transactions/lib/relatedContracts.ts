import type { RelatedContractItem } from '../../../types/api';
import { isProposalItem as isProposalListItem } from '../../contracts/lib/contractsAndProposals';

export const isProposalRelatedContract = (
  item: RelatedContractItem
): item is Extract<RelatedContractItem, { kind: 'proposal' }> =>
  isProposalListItem(item as unknown as { kind?: string });

export const isContractRelatedContract = (
  item: RelatedContractItem
): item is Exclude<RelatedContractItem, { kind: 'proposal' }> =>
  !isProposalRelatedContract(item);

export const getRelatedContractSessionId = (
  item: RelatedContractItem
): string | undefined =>
  isProposalRelatedContract(item) ? item.deliverySessionId : item.sessionId;

export const getRelatedContractTarget = (
  item: RelatedContractItem
): string | null => {
  const sessionId = getRelatedContractSessionId(item);
  if (!sessionId) {
    return null;
  }
  const base = `/contracts/${encodeURIComponent(sessionId)}`;
  return isProposalRelatedContract(item) ? `${base}?kind=proposal` : base;
};

export const getVisibleRelatedContracts = (
  relatedContracts?: RelatedContractItem[] | null
) => {
  const relatedContractsList = relatedContracts ?? [];
  const hasRelatedContract = relatedContractsList.some(
    isContractRelatedContract
  );
  const contractSessionIds = new Set(
    relatedContractsList
      .filter(isContractRelatedContract)
      .map(item => item.sessionId)
      .filter((value): value is string => Boolean(value))
  );
  const visibleRelatedContracts = hasRelatedContract
    ? relatedContractsList.filter(isContractRelatedContract)
    : relatedContractsList.filter(item => {
        if (isContractRelatedContract(item)) {
          return true;
        }
        const payNoteSessionIds = item.payNoteSessionIds ?? [];
        if (!payNoteSessionIds.length) {
          return true;
        }
        return !payNoteSessionIds.some((id: string) =>
          contractSessionIds.has(id)
        );
      });

  return {
    relatedContractsList,
    visibleRelatedContracts,
    hasRelatedContract,
  };
};
