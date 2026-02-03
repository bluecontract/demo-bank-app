import { useMemo, useState } from 'react';
import { Card } from '../../../ui/Card';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import {
  useActivity,
  type ActivityItem,
} from '../../transactions/hooks/useActivity';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { TransactionList } from '../../transactions/components/TransactionList';

type ActivityFilter = 'all' | 'transfers' | 'cards' | 'holds';

const filterOptions: { label: string; value: ActivityFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Transfers', value: 'transfers' },
  { label: 'Cards', value: 'cards' },
  { label: 'Holds', value: 'holds' },
];

const EMPTY_ACTIVITY_ITEMS: ActivityItem[] = [];

const hasCardContext = (item: ActivityItem) =>
  Boolean(
    item.cardId || item.cardLast4 || item.merchantName || item.processorChargeId
  );

const isPostedTransaction = (item: ActivityItem) =>
  item.kind === 'POSTED_TRANSACTION';

const getCardGroupKeys = (item: ActivityItem) => {
  const keys: string[] = [];
  if (item.kind === 'POSTED_TRANSACTION') {
    if (item.originHoldId) {
      keys.push(`hold-${item.originHoldId}`);
    }
  } else {
    keys.push(`hold-${item.holdId}`);
  }

  if (item.processorChargeId) {
    keys.push(`charge-${item.processorChargeId}`);
  }

  return keys;
};

export function TransactionHistory() {
  const { selectedAccount } = useSelectedAccount();
  const { data: accounts } = useAccounts();
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');

  const {
    data: activityData,
    isLoading,
    isError,
  } = useActivity({
    accountNumber: selectedAccount?.accountNumber || null,
  });

  const activityItems = activityData?.items ?? EMPTY_ACTIVITY_ITEMS;
  const filteredItems = useMemo(() => {
    if (!activityItems.length) {
      return activityItems;
    }

    switch (activeFilter) {
      case 'transfers':
        return activityItems.filter(item => isPostedTransaction(item));
      case 'cards': {
        const cardGroupIds = new Set<string>();
        activityItems.forEach(item => {
          if (hasCardContext(item)) {
            getCardGroupKeys(item).forEach(key => cardGroupIds.add(key));
          }
        });
        return activityItems.filter(item => {
          if (hasCardContext(item)) {
            return true;
          }
          return getCardGroupKeys(item).some(key => cardGroupIds.has(key));
        });
      }
      case 'holds':
        return activityItems.filter(item => !isPostedTransaction(item));
      default:
        return activityItems;
    }
  }, [activityItems, activeFilter]);

  const isEmpty = !isLoading && !isError && filteredItems.length === 0;

  return (
    <Card className="flex flex-col flex-1 min-h-0 p-0">
      <div className="border-b border-slate-200 px-4 pt-4 pb-3">
        <h2 className="text-base font-semibold text-slate-900">Transactions</h2>
      </div>

      <div className="px-4">
        <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm">
          {filterOptions.map(option => {
            const isActive = activeFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`-mb-px border-b-2 px-0 py-3 text-sm font-medium transition ${
                  isActive
                    ? 'border-[var(--color-primary)] text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
                onClick={() => setActiveFilter(option.value)}
                aria-pressed={isActive}
                data-testid={`activity-filter-${option.value}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 pt-2">
        <TransactionList
          activityItems={filteredItems}
          accountId={selectedAccount?.accountId || ''}
          currentAccountNumber={selectedAccount?.accountNumber}
          accounts={accounts}
          isLoading={isLoading}
          isError={isError}
          isEmpty={isEmpty}
          data-testid="transaction-history-list"
        />
      </div>
    </Card>
  );
}
