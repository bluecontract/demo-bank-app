import type { QueryClient } from '@tanstack/react-query';
import type {
  PayNoteDeliveryDetailsSanitized,
  PayNoteDeliverySummary,
} from '../../../types/api';

type ProposalDecision = 'accepted' | 'rejected';

const PROPOSALS_QUERY_KEY = ['proposals'] as const;
const PAYNOTE_DELIVERIES_QUERY_KEY = ['paynote-deliveries'] as const;

export type ProposalDecisionOptimisticSnapshot = {
  sessionId: string;
  hadProposals: boolean;
  hadPayNoteDeliveries: boolean;
  hadProposalDetails: boolean;
  previousProposals: PayNoteDeliverySummary[] | undefined;
  previousPayNoteDeliveries: PayNoteDeliverySummary[] | undefined;
  previousProposalDetails: PayNoteDeliveryDetailsSanitized | undefined;
};

const applyDecisionOnList = (
  items: PayNoteDeliverySummary[] | undefined,
  sessionId: string,
  decision: ProposalDecision
): PayNoteDeliverySummary[] | undefined => {
  if (!items) {
    return items;
  }

  return items.map(item => {
    if (item.deliverySessionId !== sessionId) {
      return item;
    }

    return {
      ...item,
      clientDecisionStatus: decision,
    };
  });
};

const applyDecisionOnDetails = (
  details: PayNoteDeliveryDetailsSanitized | undefined,
  decision: ProposalDecision
): PayNoteDeliveryDetailsSanitized | undefined => {
  if (!details) {
    return details;
  }

  return {
    ...details,
    clientDecisionStatus: decision,
  };
};

export async function applyOptimisticProposalDecision(
  queryClient: QueryClient,
  sessionId: string,
  decision: ProposalDecision
): Promise<ProposalDecisionOptimisticSnapshot> {
  const proposalDetailsQueryKey = ['proposal-details', sessionId] as const;

  await Promise.all([
    queryClient.cancelQueries({ queryKey: PROPOSALS_QUERY_KEY }),
    queryClient.cancelQueries({ queryKey: PAYNOTE_DELIVERIES_QUERY_KEY }),
    queryClient.cancelQueries({ queryKey: proposalDetailsQueryKey }),
  ]);

  const hadProposals = Boolean(
    queryClient.getQueryState<PayNoteDeliverySummary[]>(PROPOSALS_QUERY_KEY)
  );
  const hadPayNoteDeliveries = Boolean(
    queryClient.getQueryState<PayNoteDeliverySummary[]>(
      PAYNOTE_DELIVERIES_QUERY_KEY
    )
  );
  const hadProposalDetails = Boolean(
    queryClient.getQueryState<PayNoteDeliveryDetailsSanitized>(
      proposalDetailsQueryKey
    )
  );

  const previousProposals =
    queryClient.getQueryData<PayNoteDeliverySummary[]>(PROPOSALS_QUERY_KEY);
  const previousPayNoteDeliveries = queryClient.getQueryData<
    PayNoteDeliverySummary[]
  >(PAYNOTE_DELIVERIES_QUERY_KEY);
  const previousProposalDetails =
    queryClient.getQueryData<PayNoteDeliveryDetailsSanitized>(
      proposalDetailsQueryKey
    );

  queryClient.setQueryData<PayNoteDeliverySummary[] | undefined>(
    PROPOSALS_QUERY_KEY,
    current => applyDecisionOnList(current, sessionId, decision)
  );
  queryClient.setQueryData<PayNoteDeliverySummary[] | undefined>(
    PAYNOTE_DELIVERIES_QUERY_KEY,
    current => applyDecisionOnList(current, sessionId, decision)
  );

  if (hadProposalDetails) {
    queryClient.setQueryData<PayNoteDeliveryDetailsSanitized | undefined>(
      proposalDetailsQueryKey,
      current => applyDecisionOnDetails(current, decision)
    );
  }

  return {
    sessionId,
    hadProposals,
    hadPayNoteDeliveries,
    hadProposalDetails,
    previousProposals,
    previousPayNoteDeliveries,
    previousProposalDetails,
  };
}

export function rollbackOptimisticProposalDecision(
  queryClient: QueryClient,
  snapshot: ProposalDecisionOptimisticSnapshot
) {
  const proposalDetailsQueryKey = [
    'proposal-details',
    snapshot.sessionId,
  ] as const;

  if (snapshot.hadProposals) {
    queryClient.setQueryData(PROPOSALS_QUERY_KEY, snapshot.previousProposals);
  } else {
    queryClient.removeQueries({ queryKey: PROPOSALS_QUERY_KEY, exact: true });
  }

  if (snapshot.hadPayNoteDeliveries) {
    queryClient.setQueryData(
      PAYNOTE_DELIVERIES_QUERY_KEY,
      snapshot.previousPayNoteDeliveries
    );
  } else {
    queryClient.removeQueries({
      queryKey: PAYNOTE_DELIVERIES_QUERY_KEY,
      exact: true,
    });
  }

  if (snapshot.hadProposalDetails) {
    queryClient.setQueryData(
      proposalDetailsQueryKey,
      snapshot.previousProposalDetails
    );
  } else {
    queryClient.removeQueries({
      queryKey: proposalDetailsQueryKey,
      exact: true,
    });
  }
}
