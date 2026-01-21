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
  { label: 'All activity', value: 'all' },
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
    <Card className="flex flex-col flex-1 min-h-0">
      <div className="mb-6 flex-shrink-0 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-xl font-semibold text-slate-900">
            Transaction History
          </h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Real-time activity from transfers, holds, and card captures.
          </p>
        </div>
        {selectedAccount && (
          <div className="app-chip">
            Account:{' '}
            <span className="font-semibold">
              {selectedAccount.accountNumber}
            </span>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {filterOptions.map(option => {
          const isActive = activeFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                isActive
                  ? 'bg-[rgba(43,190,156,0.12)] text-[color:var(--color-primary)]'
                  : 'bg-white/70 text-slate-600 hover:text-slate-900'
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
    </Card>
  );
}
