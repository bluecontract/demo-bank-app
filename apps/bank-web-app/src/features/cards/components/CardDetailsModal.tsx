import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { BRAND_GRADIENT_CLASS } from '../../../ui/styleConstants';
import { formatCardExpiry } from '../lib/cardFormatters';
import type { CardDetails } from '../../../types/api';

interface CardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: CardDetails | null;
  isLoading?: boolean;
  errorMessage?: string | null;
}

const formatPan = (pan: string) => pan.replace(/(\d{4})(?=\d)/g, '$1 ');

export function CardDetailsModal({
  isOpen,
  onClose,
  card,
  isLoading = false,
  errorMessage,
}: CardDetailsModalProps) {
  if (!isOpen) {
    return null;
  }

  const panDisplay = card ? formatPan(card.pan) : '**** **** **** ****';
  const cvcDisplay = card?.cvc ?? '***';
  const showDetails = Boolean(card) && !isLoading;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      data-testid="card-details-modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={event => event.stopPropagation()}
        data-testid="card-details-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
                Card details
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                {card?.cardholderName || 'Cardholder'}
              </h3>
              {card && (
                <p className="text-sm text-slate-600 mt-1">
                  Account {card.accountNumber}
                </p>
              )}
            </div>
            {card && <span className="app-chip">{card.status}</span>}
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}

          {isLoading && !card && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" color="green" />
            </div>
          )}

          {card && showDetails && (
            <>
              <Card className={`${BRAND_GRADIENT_CLASS} text-slate-900`}>
                <div className="text-sm uppercase tracking-widest text-slate-900/70">
                  My Synchrony
                </div>
                <div className="mt-4 text-lg font-semibold">
                  {card.cardholderName || 'Cardholder'}
                </div>
                <div className="mt-6 text-xl font-mono tracking-[0.2em]">
                  {panDisplay}
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <div>
                    <div className="text-slate-900/70">Expiry</div>
                    <div className="font-medium">
                      {formatCardExpiry(card.expiryMonth, card.expiryYear)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-900/70">CVC</div>
                    <div className="font-medium">{cvcDisplay}</div>
                  </div>
                </div>
              </Card>

              <div className="grid gap-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Card ID</span>
                  <span className="font-medium text-slate-800">
                    {card.cardId}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Issued</span>
                  <span className="font-medium text-slate-800">
                    {new Date(card.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-700">
                PAN and CVC are stored in the bank for demo use. Treat them as
                sensitive.
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
