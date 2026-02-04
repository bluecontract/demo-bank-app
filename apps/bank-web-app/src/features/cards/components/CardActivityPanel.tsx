import { useMemo } from 'react';
import { Card } from '../../../ui/Card';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import {
  useActivity,
  type ActivityItem,
} from '../../transactions/hooks/useActivity';
import { TransactionList } from '../../transactions/components/TransactionList';
import { filterActivityByCardGroups } from '../../transactions/lib/activityUtils';
import type { CardSummary } from '../../../types/api';

interface CardActivityPanelProps {
  selectedCard?: CardSummary | null;
}

const EMPTY_ACTIVITY_ITEMS: ActivityItem[] = [];

const matchesSelectedCard = (item: ActivityItem, card: CardSummary) =>
  item.cardId === card.cardId || item.cardLast4 === card.panLast4;

export function CardActivityPanel({ selectedCard }: CardActivityPanelProps) {
  const { selectedAccount } = useSelectedAccount();

  const {
    data: activityData,
    isLoading,
    isError,
  } = useActivity({
    accountNumber: selectedAccount?.accountNumber ?? null,
  });

  const activityItems = activityData?.items ?? EMPTY_ACTIVITY_ITEMS;

  const filteredItems = useMemo(() => {
    if (!selectedCard || activityItems.length === 0) {
      return EMPTY_ACTIVITY_ITEMS;
    }

    return filterActivityByCardGroups(activityItems, item =>
      matchesSelectedCard(item, selectedCard)
    );
  }, [activityItems, selectedCard]);

  const isEmpty =
    !isLoading &&
    !isError &&
    Boolean(selectedCard) &&
    filteredItems.length === 0;

  return (
    <Card className="flex flex-col flex-1 min-h-0">
      <div className="mb-6 flex-shrink-0 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-xl font-semibold text-slate-900">
            Card activity
          </h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Card-specific holds and posted transactions.
          </p>
        </div>
        {selectedCard && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="app-chip app-chip-neutral">
              **** {selectedCard.panLast4}
            </span>
            {selectedCard.cardholderName && (
              <span className="app-chip app-chip-neutral">
                {selectedCard.cardholderName}
              </span>
            )}
          </div>
        )}
      </div>

      {!selectedAccount && (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Select an account to view card activity.
        </div>
      )}

      {selectedAccount && !selectedCard && (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Select a card to see its activity history.
        </div>
      )}

      {selectedAccount && selectedCard && (
        <TransactionList
          activityItems={filteredItems}
          accountId={selectedAccount.accountId}
          isLoading={isLoading}
          isError={isError}
          isEmpty={isEmpty}
          data-testid="card-activity-list"
        />
      )}
    </Card>
  );
}
