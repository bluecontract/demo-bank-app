import { useEffect, useState } from 'react';
import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useCards } from '../hooks/useCards';
import { useCardDetails } from '../hooks/useCardDetails';
import { IssueCardModal } from './IssueCardModal';
import { CardDetailsModal } from './CardDetailsModal';
import type { CardSummary } from '../../../types/api';

const formatExpiry = (month: number, year: number) => {
  const monthValue = month.toString().padStart(2, '0');
  const shortYear = year.toString().slice(-2);
  return `${monthValue}/${shortYear}`;
};

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  BLOCKED: 'bg-amber-50 text-amber-700 border border-amber-100',
  CLOSED: 'bg-slate-100 text-slate-700 border border-slate-200',
  EXPIRED: 'bg-rose-50 text-rose-700 border border-rose-100',
};

interface CardsPanelProps {
  selectedCardId?: string | null;
  onSelectCard?: (card: CardSummary | null) => void;
}

export function CardsPanel({ selectedCardId, onSelectCard }: CardsPanelProps) {
  const { selectedAccount } = useSelectedAccount();
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [detailsCardId, setDetailsCardId] = useState<string | null>(null);

  const {
    data: cards,
    isLoading,
    isError,
  } = useCards({
    accountId: selectedAccount?.accountId ?? null,
  });

  const {
    data: detailsCard,
    isLoading: isDetailsLoading,
    isError: isDetailsError,
    error: detailsError,
  } = useCardDetails(detailsCardId);

  const detailsErrorMessage = isDetailsError
    ? detailsError instanceof Error
      ? detailsError.message
      : 'Unable to load card details.'
    : null;

  const handleIssueClick = () => {
    if (selectedAccount) {
      setIsIssueOpen(true);
    }
  };

  const handleCloseIssue = () => {
    setIsIssueOpen(false);
  };

  const handleCardSelect = (card: CardSummary) => {
    onSelectCard?.(card);
  };

  const handleCardDetails = (card: CardSummary) => {
    setDetailsCardId(card.cardId);
  };

  const handleCloseDetails = () => {
    setDetailsCardId(null);
  };

  useEffect(() => {
    if (!selectedAccount) {
      onSelectCard?.(null);
    }
  }, [onSelectCard, selectedAccount]);

  useEffect(() => {
    if (!cards) {
      return;
    }

    if (cards.length === 0) {
      if (selectedCardId) {
        onSelectCard?.(null);
      }
      return;
    }

    const hasSelection = selectedCardId
      ? cards.some(card => card.cardId === selectedCardId)
      : false;

    if (!hasSelection) {
      onSelectCard?.(cards[0]);
    }
  }, [cards, onSelectCard, selectedCardId]);

  return (
    <Card className="flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Cards</h2>
          {selectedAccount ? (
            <p className="text-sm text-[color:var(--color-muted)] mt-1">
              Account {selectedAccount.accountNumber}
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-1">
              Select an account to manage cards.
            </p>
          )}
        </div>
        <Button
          variant="secondary"
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
              cards.map(card => {
                const isSelected = selectedCardId === card.cardId;

                return (
                  <div
                    key={card.cardId}
                    role="button"
                    tabIndex={0}
                    className={`w-full flex items-center justify-between gap-4 bg-white/70 border rounded-2xl p-4 shadow-sm text-left transition hover:border-emerald-200 hover:shadow-md ${
                      isSelected
                        ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.08)]'
                        : 'border-slate-200'
                    }`}
                    onClick={() => handleCardSelect(card)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleCardSelect(card);
                      }
                    }}
                    aria-label={`Select card ending ${card.panLast4}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">
                        **** {card.panLast4}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Exp {formatExpiry(card.expiryMonth, card.expiryYear)}
                        {card.cardholderName ? ` • ${card.cardholderName}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          statusStyles[card.status] ??
                          'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {card.status}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={event => {
                          event.stopPropagation();
                          handleCardSelect(card);
                          handleCardDetails(card);
                        }}
                      >
                        Details
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-500 bg-white/70 border border-dashed border-slate-200 rounded-2xl p-6 text-center">
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

      <CardDetailsModal
        isOpen={!!detailsCardId}
        onClose={handleCloseDetails}
        card={detailsCard ?? null}
        isLoading={isDetailsLoading}
        errorMessage={detailsErrorMessage}
      />
    </Card>
  );
}
