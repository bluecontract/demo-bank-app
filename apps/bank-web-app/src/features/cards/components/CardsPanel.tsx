import { useEffect, useState } from 'react';
import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useCards } from '../hooks/useCards';
import { useCardDetails } from '../hooks/useCardDetails';
import { IssueCardModal } from './IssueCardModal';
import { CardDetailsModal } from './CardDetailsModal';
import { formatCardExpiry, formatCardStatus } from '../lib/cardFormatters';
import type { CardSummary } from '../../../types/api';

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
    <Card className="flex flex-col min-h-0 p-0 overflow-hidden rounded-none sm:rounded-[20px] shadow-none sm:shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-4 px-4 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Cards</h2>
        <Button
          variant="primary"
          size="sm"
          className="rounded-full px-4"
          onClick={handleIssueClick}
          disabled={!selectedAccount}
          data-testid="issue-card-button"
        >
          Issue
        </Button>
      </div>

      <div className="flex-1 min-h-0 p-4">
        {!selectedAccount && (
          <div
            className="flex items-center justify-center h-full text-sm text-gray-500"
            data-testid="cards-no-account"
          >
            Select an account to manage cards.
          </div>
        )}

        {selectedAccount && isLoading && (
          <div
            className="flex items-center justify-center h-full"
            data-testid="cards-loading-state"
          >
            <Spinner size="lg" color="green" />
          </div>
        )}

        {selectedAccount && isError && (
          <div
            className="flex items-center justify-center h-full text-sm text-gray-500"
            data-testid="cards-error-state"
          >
            Unable to load cards. Please refresh.
          </div>
        )}

        {selectedAccount && !isLoading && !isError && (
          <div
            className="space-y-3 max-h-full overflow-y-auto pr-1"
            data-testid="cards-list"
          >
            {cards && cards.length > 0 ? (
              cards.map(card => {
                const isSelected = selectedCardId === card.cardId;

                return (
                  <div
                    key={card.cardId}
                    role="button"
                    tabIndex={0}
                    className={`w-full flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3 text-left transition ${
                      isSelected
                        ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.06)]'
                        : 'border-slate-200 bg-white/80'
                    }`}
                    onClick={() => handleCardSelect(card)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleCardSelect(card);
                      }
                    }}
                    aria-label={`Select card ending ${card.panLast4}`}
                    data-testid={`card-item-${card.cardId}`}
                  >
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-md ${
                        statusStyles[card.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {formatCardStatus(card.status)}
                    </span>
                    <div className="flex-1 min-w-[120px] text-sm text-slate-700">
                      **** {card.panLast4}
                    </div>
                    <div className="min-w-[72px] text-sm text-slate-500">
                      {formatCardExpiry(card.expiryMonth, card.expiryYear)}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full px-4"
                      onClick={event => {
                        event.stopPropagation();
                        handleCardSelect(card);
                        handleCardDetails(card);
                      }}
                      data-testid={`card-details-button-${card.cardId}`}
                    >
                      Details
                    </Button>
                  </div>
                );
              })
            ) : (
              <div
                className="text-sm text-slate-500 bg-white/70 border border-dashed border-slate-200 rounded-2xl p-6 text-center"
                data-testid="cards-empty-state"
              >
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
