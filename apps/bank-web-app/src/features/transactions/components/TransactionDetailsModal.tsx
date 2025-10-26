import { useEffect, useMemo, useState } from 'react';
import { TransactionDetails } from './TransactionDetails';
import { HoldDetails } from './HoldDetails';
import { useActivityDetail, ActivityDetail } from '../hooks/useActivityDetail';
import { useTransaction } from '../hooks/useTransaction';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import { Account } from '../../../types/api';
import { ActivityItem } from '../hooks/useActivity';
import { usePayNoteDetails } from '../hooks/usePayNoteDetails';
import { PayNoteDetailsPanel } from './PayNoteDetailsPanel';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountNumber?: string;
  activityId: string;
  selectedActivity?: ActivityItem;
  currentAccountNumber?: string;
  accounts?: Account[];
}

export function TransactionDetailsModal({
  isOpen,
  onClose,
  accountId,
  accountNumber,
  activityId,
  selectedActivity,
  currentAccountNumber,
  accounts: propAccounts,
}: TransactionDetailsModalProps) {
  const [view, setView] = useState<'activity' | 'paynote'>('activity');
  const {
    data: activityDetail,
    isLoading,
    isError,
    error,
  } = useActivityDetail({
    accountNumber: accountNumber ?? null,
    activityId,
    enabled: isOpen && !!accountNumber,
  });

  const { data: fetchedAccounts, isLoading: isLoadingAccounts } = useAccounts();

  const accounts = propAccounts || fetchedAccounts || [];
  const isPayNoteView = view === 'paynote';

  useEffect(() => {
    if (!isOpen) {
      setView('activity');
    }
  }, [isOpen]);

  useEffect(() => {
    setView('activity');
  }, [activityId, accountNumber]);

  const fallbackTransactionId =
    selectedActivity?.kind === 'POSTED_TRANSACTION'
      ? selectedActivity.transactionId
      : null;

  const {
    data: fallbackTransaction,
    isLoading: isFallbackLoading,
    isError: isFallbackError,
    error: fallbackError,
  } = useTransaction({
    accountId,
    txnId: fallbackTransactionId ?? '',
  });

  const fallbackActivityDetail: ActivityDetail | null = fallbackTransaction
    ? {
        kind: 'POSTED_TRANSACTION',
        activityId:
          selectedActivity?.activityId ?? `TXN#${fallbackTransaction.txnId}`,
        transactionId: fallbackTransaction.txnId,
        amountMinor: fallbackTransaction.amountMinor,
        description: fallbackTransaction.description,
        postedAt: fallbackTransaction.timestamp,
        originHoldId:
          selectedActivity?.kind === 'POSTED_TRANSACTION'
            ? selectedActivity.originHoldId
            : undefined,
        side: fallbackTransaction.side,
        type: fallbackTransaction.type,
        status: fallbackTransaction.status,
        counterpartyAccountNumber:
          fallbackTransaction.counterpartyAccountNumber,
      }
    : null;

  const isTransactionDetailLoading =
    accountNumber && (isLoading || (!activityDetail && isFallbackLoading));

  const resolvedTransaction =
    activityDetail?.kind === 'POSTED_TRANSACTION'
      ? activityDetail
      : fallbackActivityDetail;

  const holdDetail = activityDetail?.kind === 'HOLD' ? activityDetail : null;
  const holdTimelinePayNoteEventId = useMemo(() => {
    if (!holdDetail?.timeline) {
      return null;
    }

    const desiredType = (() => {
      switch (selectedActivity?.kind) {
        case 'HOLD_CREATED':
          return 'CREATED';
        case 'HOLD_CAPTURED':
          return 'CAPTURED';
        case 'HOLD_RELEASED':
          return 'RELEASED';
        case 'HOLD_FAILED':
          return 'FAILED';
        default:
          return null;
      }
    })();

    const matchesSelectedActivity = (
      event: (typeof holdDetail.timeline)[number]
    ) => {
      if (!selectedActivity) return false;
      if (event.payNoteEventId == null) return false;

      switch (selectedActivity.kind) {
        case 'HOLD_CREATED':
          return event.type === 'CREATED';
        case 'HOLD_CAPTURED':
          return (
            event.type === 'CAPTURED' &&
            'transactionId' in event &&
            event.transactionId === selectedActivity.transactionId
          );
        case 'HOLD_RELEASED':
          return event.type === 'RELEASED';
        case 'HOLD_FAILED':
          return event.type === 'FAILED';
        default:
          return false;
      }
    };

    if (desiredType) {
      const matchedEvent = holdDetail.timeline.find(matchesSelectedActivity);
      if (matchedEvent?.payNoteEventId) {
        return matchedEvent.payNoteEventId;
      }
    }

    const createdEventId = holdDetail.timeline.find(
      event => event.type === 'CREATED' && event.payNoteEventId
    )?.payNoteEventId;
    const fallbackEventId = holdDetail.timeline.find(
      event => event.payNoteEventId
    )?.payNoteEventId;

    return createdEventId ?? fallbackEventId ?? null;
  }, [holdDetail, selectedActivity]);

  const transactionSide = useMemo(() => {
    if (activityDetail?.kind === 'POSTED_TRANSACTION') {
      return activityDetail.side;
    }
    return resolvedTransaction?.side;
  }, [activityDetail, resolvedTransaction]);

  const shouldSuppressPayNote = transactionSide === 'CREDIT';

  const payNoteReference = useMemo(() => {
    if (shouldSuppressPayNote) {
      return null;
    }
    if (activityDetail?.payNote) {
      return activityDetail.payNote;
    }
    if (resolvedTransaction?.payNote) {
      return resolvedTransaction.payNote;
    }
    if (holdTimelinePayNoteEventId) {
      return { myosEventId: holdTimelinePayNoteEventId };
    }
    return null;
  }, [
    activityDetail,
    resolvedTransaction,
    holdTimelinePayNoteEventId,
    shouldSuppressPayNote,
  ]);
  const hasPayNote = !!payNoteReference;
  const transactionHasPayNote =
    !shouldSuppressPayNote &&
    !!(
      resolvedTransaction?.payNote ||
      (activityDetail?.kind === 'POSTED_TRANSACTION' && activityDetail?.payNote)
    );
  const holdHasPayNote = !shouldSuppressPayNote && !!holdTimelinePayNoteEventId;
  useEffect(() => {
    if (!hasPayNote) {
      setView('activity');
    }
  }, [hasPayNote]);

  const hasResolvedTransaction = !!resolvedTransaction;
  const hasHoldDetail = !!holdDetail;

  const shouldShowError =
    accountNumber &&
    !isTransactionDetailLoading &&
    !hasResolvedTransaction &&
    !hasHoldDetail &&
    (isError || isFallbackError);

  const errorMessage =
    (fallbackError instanceof Error && fallbackError.message) ||
    (error instanceof Error && error.message) ||
    'We could not load the selected activity item.';
  const {
    data: payNoteDetails,
    isLoading: isPayNoteLoading,
    isError: isPayNoteError,
    error: payNoteError,
    refetch: refetchPayNoteDetails,
  } = usePayNoteDetails({
    accountNumber: accountNumber ?? null,
    myosEventId: payNoteReference?.myosEventId,
    enabled: isOpen && isPayNoteView && hasPayNote,
  });
  const payNoteErrorStatus = (payNoteError as { status?: number } | undefined)
    ?.status;
  const payNoteErrorMessage =
    payNoteErrorStatus === 404
      ? 'PayNote details are not available yet.'
      : payNoteError?.message;

  const handleShowPayNoteDetails = () => {
    if (hasPayNote) {
      setView('paynote');
    }
  };
  const handleBackToActivityView = () => {
    setView('activity');
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="transaction-modal-backdrop"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="transaction-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {activityDetail?.kind === 'HOLD'
                ? 'Hold Details'
                : 'Transaction Details'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {!accountNumber && (
            <div
              className="p-8 text-center"
              data-testid="activity-missing-account"
            >
              <div className="text-6xl mb-4">
                <span role="img" aria-label="Warning">
                  ⚠️
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Account Required
              </h2>
              <p className="text-gray-600 mb-6">
                Select an account to view activity details.
              </p>
              <Button onClick={onClose}>Close</Button>
            </div>
          )}

          {accountNumber && isLoading && (
            <div className="p-8 text-center" data-testid="activity-loading">
              <Spinner size="lg" color="green" />
              <p className="mt-4 text-gray-600">Loading activity details...</p>
            </div>
          )}

          {shouldShowError && (
            <div className="p-8 text-center" data-testid="activity-error">
              <div className="text-6xl mb-4">
                <span role="img" aria-label="Warning">
                  ⚠️
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Activity Not Found
              </h2>
              <p className="text-gray-600 mb-4">{errorMessage}</p>
              <Button onClick={onClose}>Close</Button>
            </div>
          )}

          {isPayNoteView && hasPayNote && (
            <PayNoteDetailsPanel
              details={payNoteDetails}
              isLoading={isPayNoteLoading}
              isError={isPayNoteError}
              errorMessage={payNoteErrorMessage}
              errorStatus={payNoteErrorStatus}
              onRetry={refetchPayNoteDetails}
              onBack={handleBackToActivityView}
            />
          )}

          {!isPayNoteView && resolvedTransaction && (
            <TransactionDetails
              transaction={resolvedTransaction}
              currentAccountId={accountId}
              currentAccountNumber={
                currentAccountNumber || accountNumber || accountId
              }
              accounts={accounts || []}
              data-testid="modal-transaction-details"
              showPayNoteHelper={transactionHasPayNote}
              onViewPayNoteDetails={handleShowPayNoteDetails}
            />
          )}

          {!isPayNoteView && holdDetail && (
            <HoldDetails
              hold={holdDetail}
              accountId={accountId}
              currentAccountNumber={currentAccountNumber || accountNumber}
              isLoadingAccounts={isLoadingAccounts}
              accounts={accounts || []}
              data-testid="modal-hold-details"
              showPayNoteHelper={holdHasPayNote}
              onViewPayNoteDetails={handleShowPayNoteDetails}
            />
          )}

          {(resolvedTransaction ||
            holdDetail ||
            isTransactionDetailLoading) && (
            <div className="mt-3 pt-2 border-t border-gray-200">
              <Button onClick={onClose} variant="primary" className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
