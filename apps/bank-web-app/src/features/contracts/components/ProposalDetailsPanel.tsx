import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import type { PayNoteDeliveryDetailsSanitized } from '../../../types/api';
import { formatCurrency } from '../../../lib/formatCurrency';
import {
  useAcceptPayNoteDelivery,
  useRejectPayNoteDelivery,
  useProposalSummary,
} from '../hooks';
import { SummaryPanel } from './SummaryPanel';
import { TransactionDetailsModal } from '../../transactions/components/TransactionDetailsModal';
import { TransactionItem } from '../../transactions/components/TransactionItem';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import {
  ActivityItem,
  useActivity,
} from '../../transactions/hooks/useActivity';

interface ProposalDetailsPanelProps {
  proposal?: PayNoteDeliveryDetailsSanitized | null;
  sessionId: string | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onDecisionComplete?: () => void;
}

const formatDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getHoldEventTimestamp = (item: ActivityItem) => {
  if (item.kind === 'HOLD_CREATED') {
    return item.createdAt;
  }
  if (item.kind === 'HOLD_CAPTURED') {
    return item.capturedAt;
  }
  if (item.kind === 'HOLD_RELEASED') {
    return item.releasedAt;
  }
  if (item.kind === 'HOLD_FAILED') {
    return item.failedAt;
  }
  return '';
};

const getActivityTimestamp = (item: ActivityItem) => {
  if (item.kind === 'POSTED_TRANSACTION') {
    return item.postedAt;
  }
  return getHoldEventTimestamp(item);
};

const getActivityKey = (item: ActivityItem) =>
  item.kind === 'POSTED_TRANSACTION'
    ? `txn-${item.transactionId}`
    : `hold-${item.holdId}-${item.kind}-${getHoldEventTimestamp(item)}`;

export function ProposalDetailsPanel({
  proposal,
  sessionId,
  isLoading = false,
  isError = false,
  errorMessage,
  onDecisionComplete,
}: ProposalDetailsPanelProps) {
  const acceptMutation = useAcceptPayNoteDelivery();
  const rejectMutation = useRejectPayNoteDelivery();
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(
    null
  );
  const { data: accounts } = useAccounts();
  const activityQuery = useActivity({
    accountNumber: proposal?.accountNumber ?? null,
  });

  const isAcceptPending = acceptMutation.isPending;
  const isRejectPending = rejectMutation.isPending;
  const isDecisionPending = isAcceptPending || isRejectPending;
  const decisionSessionId = proposal?.deliverySessionId ?? sessionId;
  const summaryQuery = useProposalSummary(
    decisionSessionId,
    Boolean(proposal && decisionSessionId)
  );
  const decisionError =
    (acceptMutation.error instanceof Error
      ? acceptMutation.error.message
      : null) ??
    (rejectMutation.error instanceof Error
      ? rejectMutation.error.message
      : null);
  const generatedSummary = summaryQuery.data?.summary ?? null;
  const summaryModel = summaryQuery.data?.model ?? null;
  const summaryTimedOut = summaryQuery.timedOut;
  const summaryErrorMessage =
    summaryQuery.error instanceof Error ? summaryQuery.error.message : null;
  const isSummaryPending = !generatedSummary && !summaryTimedOut;
  const summaryFallback = summaryTimedOut
    ? 'Sorry, contract summary is not available.'
    : 'Summary not available yet.';

  const relatedTransactions = useMemo(
    () => (proposal?.transactionId ? [proposal.transactionId] : []),
    [proposal?.transactionId]
  );
  const relatedHolds = useMemo(
    () => (proposal?.holdId ? [proposal.holdId] : []),
    [proposal?.holdId]
  );
  const activityItems = useMemo(
    () => activityQuery.data?.items ?? [],
    [activityQuery.data?.items]
  );

  const activityByTransactionId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        map.set(item.transactionId, item);
      }
    }
    return map;
  }, [activityItems]);

  const activityByHoldId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        continue;
      }

      const existing = map.get(item.holdId);
      if (!existing) {
        map.set(item.holdId, item);
        continue;
      }

      const existingTime = Date.parse(getActivityTimestamp(existing));
      const nextTime = Date.parse(getActivityTimestamp(item));
      if (Number.isNaN(existingTime) || nextTime > existingTime) {
        map.set(item.holdId, item);
      }
    }

    return map;
  }, [activityItems]);

  const relatedTransactionItems = useMemo(
    () =>
      relatedTransactions
        .map(txnId => activityByTransactionId.get(txnId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByTransactionId, relatedTransactions]
  );

  const relatedHoldItems = useMemo(
    () =>
      relatedHolds
        .map(holdId => activityByHoldId.get(holdId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByHoldId, relatedHolds]
  );

  const missingTransactionIds = useMemo(
    () =>
      relatedTransactions.filter(txnId => !activityByTransactionId.has(txnId)),
    [activityByTransactionId, relatedTransactions]
  );

  const missingHoldIds = useMemo(
    () => relatedHolds.filter(holdId => !activityByHoldId.has(holdId)),
    [activityByHoldId, relatedHolds]
  );

  const handleActivitySelect = (activity: ActivityItem) => {
    if (!proposal?.accountNumber) {
      return;
    }

    setSelectedActivity(activity);
    setActiveActivityId(activity.activityId);
  };

  const handleFallbackActivityOpen = (activityId: string) => {
    if (!proposal?.accountNumber) {
      return;
    }

    setSelectedActivity(null);
    setActiveActivityId(activityId);
  };

  const isActivityLoading =
    activityQuery.isLoading &&
    (relatedTransactions.length > 0 || relatedHolds.length > 0);

  useEffect(() => {
    setActiveActivityId(null);
    setSelectedActivity(null);
  }, [proposal?.deliverySessionId, proposal?.deliveryId]);

  const handleAccept = () => {
    if (!decisionSessionId) return;
    acceptMutation.mutate(decisionSessionId, {
      onSuccess: () => {
        onDecisionComplete?.();
      },
    });
  };

  const handleReject = () => {
    if (!decisionSessionId) return;
    rejectMutation.mutate(
      { sessionId: decisionSessionId },
      {
        onSuccess: () => {
          onDecisionComplete?.();
        },
      }
    );
  };

  if (isLoading && !proposal) {
    return (
      <Card className="flex items-center justify-center min-h-[420px]">
        <Spinner size="lg" color="green" />
      </Card>
    );
  }

  if (isError && !proposal) {
    return (
      <Card className="p-6 text-sm text-slate-600">
        {errorMessage || 'Unable to load proposal details.'}
      </Card>
    );
  }

  if (!proposal) {
    return (
      <Card className="p-6 text-sm text-slate-600">
        Select a proposal to view details and accept or reject.
      </Card>
    );
  }

  const payNoteName = proposal.payNote?.name?.trim() || 'PayNote proposal';
  const amountLine =
    proposal.payNote?.amountMinor != null
      ? `${formatCurrency(proposal.payNote.amountMinor)}${
          proposal.payNote.currency ? ` ${proposal.payNote.currency}` : ''
        }`
      : 'Amount not specified';
  const decisionStatus = proposal.clientDecisionStatus ?? 'pending';
  const isDecisionLocked =
    decisionStatus === 'accepted' || decisionStatus === 'rejected';
  const account = accounts?.find(
    item => item.accountNumber === proposal.accountNumber
  );
  const hasRelatedActivity =
    relatedTransactions.length > 0 || relatedHolds.length > 0;

  return (
    <Card className="flex flex-col gap-6 min-h-0">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
          Proposal
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">
          {payNoteName}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="app-chip app-chip-neutral">Proposal</span>
          <span className="app-chip">
            {decisionStatus === 'pending'
              ? 'Pending'
              : decisionStatus === 'accepted'
              ? 'Accepted'
              : 'Rejected'}
          </span>
          {proposal.updatedAt && (
            <span className="app-chip app-chip-neutral">
              Updated {formatDate(proposal.updatedAt)}
            </span>
          )}
        </div>
      </div>

      <section className="border border-slate-200 rounded-2xl overflow-hidden bg-white/70">
        <header className="px-4 py-3 border-b border-slate-200 bg-white/80">
          <h3 className="text-sm font-semibold text-slate-900">
            PayNote details
          </h3>
        </header>
        <div className="p-4 space-y-3 text-sm text-slate-700">
          <div>
            <span className="text-slate-500">Name</span>
            <p className="font-medium text-slate-900">{payNoteName}</p>
          </div>
          <div>
            <span className="text-slate-500">Amount</span>
            <p className="font-medium text-slate-900">{amountLine}</p>
          </div>
        </div>
      </section>

      <SummaryPanel
        title="Proposal summary"
        summary={generatedSummary}
        summaryModel={summaryModel}
        summaryErrorMessage={summaryErrorMessage}
        isLoading={isSummaryPending}
        isFetching={summaryQuery.isFetching && Boolean(generatedSummary)}
        fallbackText={summaryFallback}
        loadingLabel="Generating summary..."
        fetchingLabel="Updating summary..."
      />

      {hasRelatedActivity && (
        <section className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Related activity
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Linked transactions and holds connected to this proposal.
              </p>
            </div>
          </div>

          {isActivityLoading && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500 flex items-center gap-3">
              <Spinner size="sm" color="green" />
              Loading related activity details...
            </div>
          )}

          {!isActivityLoading && (
            <div className="mt-4 space-y-4">
              {relatedTransactions.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Transactions
                  </p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 divide-y divide-slate-100">
                    {relatedTransactionItems.map(item => (
                      <TransactionItem
                        key={getActivityKey(item)}
                        item={item}
                        onActivitySelect={handleActivitySelect}
                      />
                    ))}
                    {missingTransactionIds.map(txnId => (
                      <div
                        key={txnId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            Transaction {txnId}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Details pending in activity feed.
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!proposal.accountNumber}
                          onClick={() =>
                            handleFallbackActivityOpen(`TXN#${txnId}`)
                          }
                        >
                          View details
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {relatedHolds.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Holds
                  </p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 divide-y divide-slate-100">
                    {relatedHoldItems.map(item => (
                      <TransactionItem
                        key={getActivityKey(item)}
                        item={item}
                        onActivitySelect={handleActivitySelect}
                      />
                    ))}
                    {missingHoldIds.map(holdId => (
                      <div
                        key={holdId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            Hold {holdId}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Details pending in activity feed.
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!proposal.accountNumber}
                          onClick={() =>
                            handleFallbackActivityOpen(`HOLD#${holdId}`)
                          }
                        >
                          View details
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {!isDecisionLocked && (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Accept or reject
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Record your decision on this PayNote proposal. Accepting will
              create the PayNote contract.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isDecisionPending}
                onClick={handleReject}
              >
                {isRejectPending ? 'Rejecting...' : 'Reject'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isDecisionPending}
                onClick={handleAccept}
              >
                {isAcceptPending ? 'Accepting...' : 'Accept'}
              </Button>
            </div>
            {decisionError && (
              <p className="mt-3 text-sm text-rose-600">{decisionError}</p>
            )}
          </div>
        </section>
      )}

      {isDecisionLocked && (
        <p className="text-sm text-slate-600">
          {decisionStatus === 'accepted'
            ? "You're all set. We're preparing the contract for you."
            : 'This proposal has already been rejected.'}
        </p>
      )}

      <TransactionDetailsModal
        isOpen={!!activeActivityId}
        onClose={() => {
          setActiveActivityId(null);
          setSelectedActivity(null);
        }}
        accountId={account?.accountId ?? ''}
        accountNumber={proposal.accountNumber ?? ''}
        activityId={activeActivityId ?? ''}
        selectedActivity={selectedActivity ?? undefined}
        currentAccountNumber={proposal.accountNumber ?? undefined}
        accounts={accounts}
      />
    </Card>
  );
}
