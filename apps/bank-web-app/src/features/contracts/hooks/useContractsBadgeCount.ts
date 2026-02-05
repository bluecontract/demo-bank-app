import { useMemo } from 'react';
import { useActiveContractSession } from './useActiveContractSession';
import { useContractReviewState } from './useContractReviewState';
import { useContracts } from './useContracts';
import { useProposals } from './useProposals';
import { dedupeContracts } from '../lib/dedupeContracts';
import { getContractChangeType } from '../lib/contractReview';
import {
  mergeContractsAndProposals,
  isProposalItem,
} from '../lib/contractsAndProposals';
import {
  isInboxContract,
  isImportantProposal,
} from '../lib/contractListFilters';

const POLLING_INTERVAL_MS = 5000;

export function useContractsBadgeCount() {
  const { reviewedMap } = useContractReviewState();
  const { activeSessionId } = useActiveContractSession();
  const contractsQuery = useContracts({ refetchInterval: POLLING_INTERVAL_MS });
  const proposalsQuery = useProposals();

  return useMemo(() => {
    const contracts = contractsQuery.data
      ? dedupeContracts(contractsQuery.data)
      : [];
    const proposals = proposalsQuery.data ?? [];

    if (contracts.length === 0 && proposals.length === 0) {
      return 0;
    }

    const listItems = mergeContractsAndProposals(contracts, proposals);
    const inboxContracts = listItems.filter(isInboxContract);
    const inboxCount = inboxContracts.filter(contract => {
      if (activeSessionId && contract.sessionId === activeSessionId) {
        return false;
      }
      return Boolean(getContractChangeType(contract, reviewedMap));
    }).length;
    const importantCount = listItems.filter(
      item => isProposalItem(item) && isImportantProposal(item)
    ).length;

    return inboxCount + importantCount;
  }, [activeSessionId, contractsQuery.data, proposalsQuery.data, reviewedMap]);
}
