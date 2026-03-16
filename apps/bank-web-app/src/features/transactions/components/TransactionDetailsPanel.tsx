import { TransactionDetails } from './TransactionDetails';
import { HoldDetails } from './HoldDetails';
import { useActivityDetail, ActivityDetail } from '../hooks/useActivityDetail';
import { useTransaction } from '../hooks/useTransaction';
import { useTransactionContracts } from '../hooks/useTransactionContracts';
import { useHoldContracts } from '../hooks/useHoldContracts';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import { Account } from '../../../types/api';
import { ActivityItem } from '../hooks/useActivity';

interface TransactionDetailsPanelProps {
  accountId: string;
  accountNumber?: string;
  activityId: string;
  selectedActivity?: ActivityItem;
  currentAccountNumber?: string;
  accounts?: Account[];
  userEmail?: string;
  isActive?: boolean;
  closeLabel?: string;
  showFooterAction?: boolean;
  onClose?: () => void;
}

export function TransactionDetailsPanel({
  accountId,
  accountNumber,
  activityId,
  selectedActivity,
  currentAccountNumber,
  accounts: propAccounts,
  userEmail,
  isActive = true,
  closeLabel = 'Close',
  showFooterAction = false,
  onClose,
}: TransactionDetailsPanelProps) {
  const {
    data: activityDetail,
    isLoading,
    isError,
    error,
  } = useActivityDetail({
    accountNumber: accountNumber ?? null,
    activityId,
    enabled: isActive && !!accountNumber,
  });

  const { data: fetchedAccounts, isLoading: isLoadingAccounts } = useAccounts();
  const accounts = propAccounts || fetchedAccounts || [];

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

  const fallbackCardFields =
    selectedActivity?.kind === 'POSTED_TRANSACTION'
      ? {
          cardId: selectedActivity.cardId,
          cardLast4: selectedActivity.cardLast4,
          merchantName: selectedActivity.merchantName,
          merchantStatementDescriptor:
            selectedActivity.merchantStatementDescriptor,
          processorChargeId: selectedActivity.processorChargeId,
        }
      : {};

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
        ...fallbackCardFields,
      }
    : null;

  const isTransactionDetailLoading =
    accountNumber && (isLoading || (!activityDetail && isFallbackLoading));

  const resolvedTransaction =
    activityDetail?.kind === 'POSTED_TRANSACTION'
      ? activityDetail
      : fallbackActivityDetail;

  const {
    data: relatedContracts,
    isLoading: isRelatedContractsLoading,
    isError: isRelatedContractsError,
    error: relatedContractsError,
  } = useTransactionContracts({
    transactionId: resolvedTransaction?.transactionId ?? null,
    enabled: isActive && !!resolvedTransaction,
  });

  const relatedContractsErrorMessage =
    isRelatedContractsError && relatedContractsError instanceof Error
      ? relatedContractsError.message
      : undefined;

  const holdDetail = activityDetail?.kind === 'HOLD' ? activityDetail : null;
  const {
    data: relatedHoldContracts,
    isLoading: isHoldContractsLoading,
    isError: isHoldContractsError,
    error: holdContractsError,
  } = useHoldContracts({
    holdId: holdDetail?.holdId ?? null,
    enabled: isActive && !!holdDetail,
  });
  const holdContractsErrorMessage =
    isHoldContractsError && holdContractsError instanceof Error
      ? holdContractsError.message
      : undefined;

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

  return (
    <div className="flex flex-col gap-4">
      {!accountNumber && (
        <div className="p-8 text-center" data-testid="activity-missing-account">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Warning">
              ⚠️
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Account Required
          </h2>
          <p className="text-slate-600 mb-6">
            Select an account to view activity details.
          </p>
          {onClose && <Button onClick={onClose}>{closeLabel}</Button>}
        </div>
      )}

      {accountNumber && isLoading && (
        <div className="p-8 text-center" data-testid="activity-loading">
          <Spinner size="lg" color="green" />
          <p className="mt-4 text-slate-600">Loading activity details...</p>
        </div>
      )}

      {shouldShowError && (
        <div className="p-8 text-center" data-testid="activity-error">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Warning">
              ⚠️
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Activity Not Found
          </h2>
          <p className="text-slate-600 mb-4">{errorMessage}</p>
          {onClose && <Button onClick={onClose}>{closeLabel}</Button>}
        </div>
      )}

      {resolvedTransaction && (
        <TransactionDetails
          transaction={resolvedTransaction}
          currentAccountId={accountId}
          currentAccountNumber={currentAccountNumber || accountNumber || ''}
          accounts={accounts || []}
          data-testid="transaction-details"
          relatedContracts={relatedContracts ?? []}
          isRelatedContractsLoading={isRelatedContractsLoading}
          relatedContractsError={relatedContractsErrorMessage}
          userEmail={userEmail}
        />
      )}

      {holdDetail && (
        <HoldDetails
          hold={holdDetail}
          accountId={accountId}
          currentAccountNumber={currentAccountNumber || accountNumber}
          isLoadingAccounts={isLoadingAccounts}
          accounts={accounts || []}
          data-testid="hold-details"
          relatedContracts={relatedHoldContracts ?? []}
          isRelatedContractsLoading={isHoldContractsLoading}
          relatedContractsError={holdContractsErrorMessage}
        />
      )}

      {showFooterAction &&
        (resolvedTransaction || holdDetail || isTransactionDetailLoading) && (
          <div className="mt-3 pt-2 border-t border-slate-200">
            {onClose && (
              <Button onClick={onClose} variant="primary" className="w-full">
                {closeLabel}
              </Button>
            )}
          </div>
        )}
    </div>
  );
}
