import { useState } from 'react';
import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useCards } from '../hooks/useCards';
import { IssueCardModal } from './IssueCardModal';

const formatExpiry = (month: number, year: number) => {
  const monthValue = month.toString().padStart(2, '0');
  const shortYear = year.toString().slice(-2);
  return `${monthValue}/${shortYear}`;
};

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  BLOCKED: 'bg-yellow-100 text-yellow-800',
  CLOSED: 'bg-gray-100 text-gray-700',
  EXPIRED: 'bg-red-100 text-red-700',
};

export function CardsPanel() {
  const { selectedAccount } = useSelectedAccount();
  const [isIssueOpen, setIsIssueOpen] = useState(false);

  const {
    data: cards,
    isLoading,
    isError,
  } = useCards({
    accountId: selectedAccount?.accountId ?? null,
  });

  const handleIssueClick = () => {
    if (selectedAccount) {
      setIsIssueOpen(true);
    }
  };

  const handleCloseIssue = () => {
    setIsIssueOpen(false);
  };

  return (
    <Card className="p-6 flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Cards</h2>
          {selectedAccount ? (
            <p className="text-sm text-gray-600 mt-1">
              Account {selectedAccount.accountNumber}
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-1">
              Select an account to manage cards.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleIssueClick}
          disabled={!selectedAccount}
        >
          Issue Card
        </Button>
      </div>

      <div className="mt-4 flex-1 min-h-0">
        {!selectedAccount && (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Choose an account to see issued cards.
          </div>
        )}

        {selectedAccount && isLoading && (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" color="green" />
          </div>
        )}

        {selectedAccount && isError && (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Unable to load cards. Please refresh.
          </div>
        )}

        {selectedAccount && !isLoading && !isError && (
          <div className="space-y-3 max-h-full overflow-y-auto pr-1">
            {cards && cards.length > 0 ? (
              cards.map(card => (
                <div
                  key={card.cardId}
                  className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-4"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      **** {card.panLast4}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Exp {formatExpiry(card.expiryMonth, card.expiryYear)}
                      {card.cardholderName ? ` • ${card.cardholderName}` : ''}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      statusStyles[card.status] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {card.status}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
                No cards yet. Issue your first card to get started.
              </div>
            )}
          </div>
        )}
      </div>

      <IssueCardModal
        isOpen={isIssueOpen}
        onClose={handleCloseIssue}
        accountId={selectedAccount?.accountId ?? ''}
        accountName={selectedAccount?.name ?? ''}
      />
    </Card>
  );
}
