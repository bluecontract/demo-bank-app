import type { ContractSummary } from '../../../types/api';
import type { PayNoteDeliverySummary } from '../../../types/api';

export type ProposalListItem = PayNoteDeliverySummary & {
  kind: 'proposal';
};

export type MergedContractItem = ContractSummary & {
  originProposalDeliveryId?: string;
  originProposalSessionId?: string;
  sortUpdatedAt?: string;
};

export type ContractOrProposalItem = MergedContractItem | ProposalListItem;

export const isProposalItem = (
  item: ContractOrProposalItem
): item is ProposalListItem =>
  'kind' in item && (item as ProposalListItem).kind === 'proposal';

const parseTimestamp = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getItemSessionId = (
  item: ContractOrProposalItem
): string | undefined =>
  isProposalItem(item) ? item.deliverySessionId : item.sessionId;

export const getItemUpdatedAt = (item: ContractOrProposalItem): string =>
  item.updatedAt;

const getItemSortUpdatedAt = (item: ContractOrProposalItem): string =>
  'sortUpdatedAt' in item && item.sortUpdatedAt
    ? item.sortUpdatedAt
    : item.updatedAt;

const isContractReadyForInbox = (contract: ContractSummary): boolean => {
  const status = contract.status?.trim().toLowerCase();
  if (!status) {
    return false;
  }
  return status !== 'bootstrapped';
};

export function mergeContractsAndProposals(
  contracts: ContractSummary[],
  proposals: PayNoteDeliverySummary[]
): ContractOrProposalItem[] {
  const contractBySessionId = new Map(
    contracts
      .map(contract => [contract.sessionId, contract] as const)
      .filter((entry): entry is [string, ContractSummary] => Boolean(entry[0]))
  );
  const contractSessionIds = new Set(
    contracts
      .map(contract => contract.sessionId)
      .filter((value): value is string => Boolean(value))
  );

  const matchedContractSessionIds = new Set<string>();
  const mergedItems: ContractOrProposalItem[] = [];

  for (const proposal of proposals) {
    const payNoteSessionIds = proposal.payNoteSessionIds ?? [];
    const matchingSessionId = payNoteSessionIds.find(id =>
      contractSessionIds.has(id)
    );
    if (matchingSessionId) {
      const contract = contractBySessionId.get(matchingSessionId);
      if (contract) {
        if (!isContractReadyForInbox(contract)) {
          matchedContractSessionIds.add(matchingSessionId);
          mergedItems.push({
            ...proposal,
            kind: 'proposal' as const,
          });
        } else {
          matchedContractSessionIds.add(matchingSessionId);
          mergedItems.push({
            ...contract,
            originProposalDeliveryId: proposal.deliveryId,
            originProposalSessionId: proposal.deliverySessionId,
            sortUpdatedAt: proposal.updatedAt,
          });
        }
        continue;
      }
    }

    mergedItems.push({
      ...proposal,
      kind: 'proposal' as const,
    });
  }

  const unmatchedContracts = contracts.filter(
    contract =>
      !contract.sessionId || !matchedContractSessionIds.has(contract.sessionId)
  );

  const combined: ContractOrProposalItem[] = [
    ...unmatchedContracts,
    ...mergedItems,
  ];

  return combined.sort((a, b) => {
    const aTime = parseTimestamp(getItemSortUpdatedAt(a));
    const bTime = parseTimestamp(getItemSortUpdatedAt(b));
    return bTime - aTime;
  });
}
