import type { ContractSummary } from '../../../types/api';
import type { PayNoteDeliverySummary } from '../../../types/api';

export type ProposalListItem = PayNoteDeliverySummary & {
  kind: 'proposal';
};

export type ContractOrProposalItem = ContractSummary | ProposalListItem;

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

export function mergeContractsAndProposals(
  contracts: ContractSummary[],
  proposals: PayNoteDeliverySummary[]
): ContractOrProposalItem[] {
  const proposalItems: ProposalListItem[] = proposals.map(p => ({
    ...p,
    kind: 'proposal' as const,
  }));

  const combined: ContractOrProposalItem[] = [...contracts, ...proposalItems];

  return combined.sort((a, b) => {
    const aTime = parseTimestamp(getItemUpdatedAt(a));
    const bTime = parseTimestamp(getItemUpdatedAt(b));
    return bTime - aTime;
  });
}
