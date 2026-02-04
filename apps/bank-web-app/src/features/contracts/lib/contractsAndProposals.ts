import type {
  ContractSummary,
  PayNoteDeliverySummary,
} from '../../../types/api';
import { getContractLastChangeAt } from './contractTimestamps';

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

const normalizeName = (value?: string) => value?.trim().toLowerCase() || '';

export const getItemSessionId = (
  item: ContractOrProposalItem
): string | undefined =>
  isProposalItem(item) ? item.deliverySessionId : item.sessionId;

export const getItemUpdatedAt = (item: ContractOrProposalItem): string => {
  if (!isProposalItem(item)) {
    return getContractLastChangeAt(item) ?? item.updatedAt;
  }
  return item.updatedAt;
};

const getItemSortUpdatedAt = (item: ContractOrProposalItem): string => {
  if ('sortUpdatedAt' in item && item.sortUpdatedAt) {
    return item.sortUpdatedAt;
  }
  return getItemUpdatedAt(item);
};

const getItemDedupeKey = (item: ContractOrProposalItem): string | null => {
  const sessionId = getItemSessionId(item);
  if (sessionId) {
    return sessionId;
  }
  if (isProposalItem(item)) {
    return item.deliveryId ?? null;
  }
  return item.contractId ?? null;
};

const dedupeMergedItems = (
  items: ContractOrProposalItem[]
): ContractOrProposalItem[] => {
  const deduped = new Map<string, ContractOrProposalItem>();
  const fallback: ContractOrProposalItem[] = [];

  for (const item of items) {
    const key = getItemDedupeKey(item);
    if (!key) {
      fallback.push(item);
      continue;
    }
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    const existingTime = parseTimestamp(getItemSortUpdatedAt(existing));
    const candidateTime = parseTimestamp(getItemSortUpdatedAt(item));
    if (candidateTime > existingTime) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values(), ...fallback];
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
  const contractByName = new Map<string, ContractSummary>();
  const contractSessionIds = new Set(
    contracts
      .map(contract => contract.sessionId)
      .filter((value): value is string => Boolean(value))
  );

  const matchedContractSessionIds = new Set<string>();
  const matchedContractIds = new Set<string>();
  const mergedItems: ContractOrProposalItem[] = [];

  for (const contract of contracts) {
    const nameKey = normalizeName(
      contract.documentName ?? contract.displayName
    );
    if (!nameKey) {
      continue;
    }
    const existing = contractByName.get(nameKey);
    if (
      !existing ||
      parseTimestamp(contract.updatedAt) > parseTimestamp(existing.updatedAt)
    ) {
      contractByName.set(nameKey, contract);
    }
  }

  for (const proposal of proposals) {
    const decisionStatus = proposal.clientDecisionStatus?.trim().toLowerCase();
    const isRejected = decisionStatus === 'rejected';
    const payNoteSessionIds = proposal.payNoteSessionIds ?? [];
    const candidateSessionIds = new Set(
      [...payNoteSessionIds, proposal.deliverySessionId].filter(
        (id): id is string => Boolean(id)
      )
    );
    const matchingSessionId = Array.from(candidateSessionIds).find(id =>
      contractSessionIds.has(id)
    );
    if (!isRejected && matchingSessionId) {
      const contract = contractBySessionId.get(matchingSessionId);
      if (contract) {
        matchedContractSessionIds.add(matchingSessionId);
        matchedContractIds.add(contract.contractId);
        mergedItems.push({
          ...contract,
          originProposalDeliveryId: proposal.deliveryId,
          originProposalSessionId: proposal.deliverySessionId,
          sortUpdatedAt: proposal.updatedAt,
        });
        continue;
      }
    }

    if (!isRejected && decisionStatus === 'accepted') {
      const nameKey = normalizeName(proposal.name);
      const contract = nameKey ? contractByName.get(nameKey) : undefined;
      if (contract) {
        if (contract.sessionId) {
          matchedContractSessionIds.add(contract.sessionId);
        }
        matchedContractIds.add(contract.contractId);
        mergedItems.push({
          ...contract,
          originProposalDeliveryId: proposal.deliveryId,
          originProposalSessionId: proposal.deliverySessionId,
          sortUpdatedAt: proposal.updatedAt,
        });
        continue;
      }
    }

    mergedItems.push({
      ...proposal,
      kind: 'proposal' as const,
    });
  }

  const unmatchedContracts = contracts.filter(contract => {
    if (matchedContractIds.has(contract.contractId)) {
      return false;
    }
    if (
      contract.sessionId &&
      matchedContractSessionIds.has(contract.sessionId)
    ) {
      return false;
    }
    return true;
  });

  const combined: ContractOrProposalItem[] = [
    ...unmatchedContracts,
    ...mergedItems,
  ];

  const dedupedCombined = dedupeMergedItems(combined);

  return dedupedCombined.sort((a, b) => {
    const aTime = parseTimestamp(getItemSortUpdatedAt(a));
    const bTime = parseTimestamp(getItemSortUpdatedAt(b));
    return bTime - aTime;
  });
}
