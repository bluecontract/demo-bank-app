import { useMemo } from 'react';
import { useActiveContractSession } from './useActiveContractSession';
import { useContractReviewState } from './useContractReviewState';
import { useContracts } from './useContracts';
import { useProposals } from './useProposals';
import { dedupeContracts } from '../lib/dedupeContracts';
import { getItemChangeType } from '../lib/contractReview';
import {
  mergeContractsAndProposals,
  getItemSessionId,
} from '../lib/contractsAndProposals';
import { isInboxItem } from '../lib/contractListFilters';
import { getContractsPollingInterval } from '../lib/contractsPolling';

export function useContractsBadgeCount() {
  const { reviewedMap } = useContractReviewState();
  const { activeSessionId } = useActiveContractSession();
  const refetchInterval = getContractsPollingInterval();
  const contractsQuery = useContracts({ refetchInterval });
  const proposalsQuery = useProposals({ refetchInterval });

  return useMemo(() => {
    const contracts = contractsQuery.data
      ? dedupeContracts(contractsQuery.data)
      : [];
    const proposals = proposalsQuery.data ?? [];

    if (contracts.length === 0 && proposals.length === 0) {
      return 0;
    }

    const listItems = mergeContractsAndProposals(contracts, proposals);
    const inboxItems = listItems.filter(isInboxItem);
    const inboxCount = inboxItems.filter(item => {
      const sessionId = getItemSessionId(item);
      if (activeSessionId && sessionId && sessionId === activeSessionId) {
        return false;
      }
      return Boolean(getItemChangeType(item, reviewedMap));
    }).length;

    return inboxCount;
  }, [activeSessionId, contractsQuery.data, proposalsQuery.data, reviewedMap]);
}
