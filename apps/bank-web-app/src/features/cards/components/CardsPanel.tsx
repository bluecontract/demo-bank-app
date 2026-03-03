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
  ACTIVE:
    'bg-[var(--color-primary-tint)] text-[var(--color-primary)] border border-[var(--color-primary)]',
  BLOCKED: 'bg-amber-50 text-amber-700 border border-amber-200',
  CLOSED: 'bg-slate-100 text-slate-700 border border-slate-200',
  EXPIRED: 'bg-rose-50 text-rose-700 border border-rose-200',
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
    <Card className="flex flex-col min-h-0 overflow-hidden rounded-none !p-0 shadow-none sm:rounded-[16px]">
      <div className="flex items-center justify-between gap-4 border-b border-[color:var(--color-border)] px-4 py-4">
        <h2 className="text-base font-semibold text-slate-900">Cards</h2>
        <Button
          variant="primary"
          size="sm"
          className="rounded-full px-4 py-2 text-sm leading-6"
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
            className="max-h-full space-y-4 overflow-y-auto"
            data-testid="cards-list"
          >
            {cards && cards.length > 0 ? (
              cards.map(card => {
                return (
                  <div
                    key={card.cardId}
                    role="button"
                    tabIndex={0}
                    className="flex h-16 w-full items-center gap-4 rounded-lg border border-[color:var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left"
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
                      className={`rounded px-2 py-0.5 text-sm leading-6 ${
                        statusStyles[card.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {formatCardStatus(card.status)}
                    </span>
                    <div className="flex-1 text-sm leading-6 text-[color:var(--color-muted)]">
                      ***{card.panLast4}
                    </div>
                    <div className="min-w-[72px] text-sm leading-6 text-[color:var(--color-muted)]">
                      {formatCardExpiry(card.expiryMonth, card.expiryYear)}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full px-4 py-2 text-sm leading-6"
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
