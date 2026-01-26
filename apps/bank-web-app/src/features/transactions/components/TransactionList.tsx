import { useEffect, useState } from 'react';
import { TransactionItem } from './TransactionItem';
import { TransactionDetailsModal } from './TransactionDetailsModal';
import { ActivityItem } from '../hooks/useActivity';
import { Spinner } from '../../../ui/Spinner';
import { Account } from '../../../types/api';

interface TransactionListProps {
  activityItems: ActivityItem[];
  accountId: string;
  currentAccountNumber?: string;
  accounts?: Account[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  'data-testid'?: string;
}

export function TransactionList({
  activityItems,
  accountId,
  currentAccountNumber,
  accounts = [],
  isLoading,
  isError,
  isEmpty,
  'data-testid': testId,
}: TransactionListProps) {
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(
    null
  );

  const handleActivitySelect = (activity: ActivityItem) => {
    setSelectedActivity(activity);
  };

  const handleCloseModal = () => {
    setSelectedActivity(null);
  };

  useEffect(() => {
    // Reset selection when account context changes to avoid stale details
    setSelectedActivity(null);
  }, [accountId, currentAccountNumber]);

  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-2 text-sm text-slate-500">
            Loading account activity...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center text-slate-500">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Warning">
              ⚠️
            </span>
          </div>
          <div className="text-xl mb-2">Failed to load account activity</div>
          <p className="text-sm">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center text-slate-500">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Clipboard">
              📋
            </span>
          </div>
          <div className="text-xl mb-2">No activity yet</div>
          <p className="text-sm">
            Account activity will appear here once you post a transaction or
            create a hold.
          </p>
        </div>
      </div>
    );
  }

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

  const getActivityKey = (item: ActivityItem) =>
    item.kind === 'POSTED_TRANSACTION'
      ? `txn-${item.transactionId}`
      : `hold-${item.holdId}-${item.kind}-${getHoldEventTimestamp(item)}`;

  const getActivityTestId = (item: ActivityItem) =>
    item.kind === 'POSTED_TRANSACTION'
      ? `activity-item-txn-${item.transactionId}`
      : `activity-item-${item.kind.toLowerCase()}-${item.holdId}`;

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0" data-testid={testId}>
        <div className="flex-1 overflow-y-auto bg-white/80 rounded-2xl border border-slate-200">
          <div className="divide-y divide-slate-100">
            {activityItems.map(item => {
              return (
                <TransactionItem
                  key={getActivityKey(item)}
                  item={item}
                  onActivitySelect={handleActivitySelect}
                  data-testid={getActivityTestId(item)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {selectedActivity && (
        <TransactionDetailsModal
          isOpen={!!selectedActivity}
          onClose={handleCloseModal}
          accountId={accountId}
          accountNumber={currentAccountNumber}
          activityId={selectedActivity.activityId}
          selectedActivity={selectedActivity}
          currentAccountNumber={currentAccountNumber}
          accounts={accounts}
        />
      )}
    </>
  );
}
