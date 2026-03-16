import { useMemo, useState } from 'react';
import { Card } from '../../../ui/Card';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import {
  useActivity,
  type ActivityItem,
} from '../../transactions/hooks/useActivity';
import { TransactionList } from '../../transactions/components/TransactionList';
import { filterActivityByCardGroups } from '../../transactions/lib/activityUtils';

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

interface TransactionHistoryProps {
  cardId?: string | null;
}

export function TransactionHistory({ cardId }: TransactionHistoryProps) {
  const { selectedAccount } = useSelectedAccount();
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

    let items = activityItems;
    switch (activeFilter) {
      case 'transfers':
        items = activityItems.filter(item => isPostedTransaction(item));
        break;
      case 'cards': {
        items = filterActivityByCardGroups(activityItems, hasCardContext);
        break;
      }
      case 'holds':
        items = activityItems.filter(item => !isPostedTransaction(item));
        break;
      default:
        items = activityItems;
        break;
    }

    if (!cardId) {
      return items;
    }

    return items.filter(item => item.cardId === cardId);
  }, [activityItems, activeFilter, cardId]);

  const isEmpty = !isLoading && !isError && filteredItems.length === 0;

  return (
    <Card className="flex flex-col flex-1 min-h-0 !p-0 rounded-none sm:rounded-[20px] shadow-none sm:shadow-[var(--shadow-soft)]">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-base font-semibold text-slate-900">Transactions</h2>
      </div>

      <div className="px-4 hidden sm:block">
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

      <div className="flex-1 min-h-0">
        <TransactionList
          activityItems={filteredItems}
          accountId={selectedAccount?.accountId || ''}
          isLoading={isLoading}
          isError={isError}
          isEmpty={isEmpty}
          data-testid="transaction-history-list"
        />
      </div>
    </Card>
  );
}
