import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TransactionItem } from './TransactionItem';
import { ActivityItem } from '../hooks/useActivity';
import { Spinner } from '../../../ui/Spinner';
import { buildTransactionDetailsPath } from '../lib/activityRoutes';
import {
  collapseActivityLifecycle,
  getActivityKey,
} from '../lib/activityUtils';

interface TransactionListProps {
  activityItems: ActivityItem[];
  accountId: string;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  collapseLifecycle?: boolean;
  'data-testid'?: string;
}

export function TransactionList({
  activityItems,
  accountId,
  isLoading,
  isError,
  isEmpty,
  collapseLifecycle = true,
  'data-testid': testId,
}: TransactionListProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleActivitySelect = (activity: ActivityItem) => {
    if (!accountId) {
      return;
    }
    navigate(buildTransactionDetailsPath(accountId, activity.activityId), {
      state: {
        from: `${location.pathname}${location.search}`,
        selectedActivity: activity,
      },
    });
  };

  const displayItems = useMemo(
    () =>
      collapseLifecycle
        ? collapseActivityLifecycle(activityItems)
        : activityItems,
    [activityItems, collapseLifecycle]
  );

  const shouldShowEmpty =
    isEmpty || (!isLoading && !isError && displayItems.length === 0);

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

  if (shouldShowEmpty) {
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

  const getActivityTestId = (item: ActivityItem) =>
    item.kind === 'POSTED_TRANSACTION'
      ? `activity-item-txn-${item.transactionId}`
      : `activity-item-${item.kind.toLowerCase()}-${item.holdId}`;

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid={testId}>
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-slate-200">
          {displayItems.map(item => {
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
  );
}
