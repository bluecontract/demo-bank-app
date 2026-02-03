import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { BRAND_GRADIENT_CLASS } from '../../../ui/styleConstants';
import { useIssueCard } from '../hooks/useIssueCard';
import { formatCardExpiry } from '../lib/cardFormatters';
import { IssueCardResponse } from '../../../types/api';

interface IssueCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountName: string;
}

export function IssueCardModal({
  isOpen,
  onClose,
  accountId,
  accountName,
}: IssueCardModalProps) {
  const [cardholderName, setCardholderName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issuedCard, setIssuedCard] = useState<IssueCardResponse | null>(null);
  const issueCard = useIssueCard();

  const handleClose = () => {
    setCardholderName('');
    setErrorMessage(null);
    setIssuedCard(null);
    issueCard.reset();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) {
      setErrorMessage('Select an account to issue a card.');
      return;
    }

    issueCard.mutate(
      {
        accountId,
        cardholderName: cardholderName.trim() || undefined,
      },
      {
        onSuccess: data => {
          setErrorMessage(null);
          setIssuedCard(data);
        },
        onError: error => {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to issue card'
          );
        },
      }
    );
  };

  const handleIssueAnother = () => {
    setIssuedCard(null);
    setCardholderName('');
    setErrorMessage(null);
    issueCard.reset();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="issue-card-modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="issue-card-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          {!issuedCard && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Issue a new card
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  {accountName
                    ? `Linked to ${accountName}.`
                    : 'Select an account to continue.'}
                </p>
              </div>

              <div>
                <label
                  htmlFor="cardholderName"
                  className="block text-sm font-medium text-slate-700"
                >
                  Cardholder name (optional)
                </label>
                <input
                  id="cardholderName"
                  type="text"
                  value={cardholderName}
                  onChange={event => setCardholderName(event.target.value)}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]"
                  placeholder="e.g., Taylor Jordan"
                  maxLength={100}
                />
              </div>

              {errorMessage && (
                <div className="text-sm text-red-600">{errorMessage}</div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={handleClose}
                  disabled={issueCard.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={issueCard.isPending}
                >
                  {issueCard.isPending ? 'Issuing...' : 'Issue Card'}
                </Button>
              </div>
            </form>
          )}

          {issuedCard && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Card issued successfully
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  These details are saved to your account. You can view them
                  later in the card details view.
                </p>
              </div>

              <div
                className={`rounded-2xl ${BRAND_GRADIENT_CLASS} text-slate-900 p-5`}
              >
                <div className="text-sm uppercase tracking-widest text-slate-900/70">
                  Demo Bank
                </div>
                <div className="mt-4 text-lg font-semibold">
                  {issuedCard.cardholderName || 'Cardholder'}
                </div>
                <div
                  className="mt-6 text-xl font-mono tracking-[0.2em]"
                  data-testid="issued-card-pan"
                >
                  {issuedCard.pan}
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <div>
                    <div className="text-slate-900/70">Expiry</div>
                    <div
                      className="font-medium"
                      data-testid="issued-card-expiry"
                    >
                      {formatCardExpiry(
                        issuedCard.expiryMonth,
                        issuedCard.expiryYear
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-900/70">CVC</div>
                    <div className="font-medium" data-testid="issued-card-cvc">
                      {issuedCard.cvc}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-4 text-sm text-amber-700">
                Card details are saved to your account for demo use. You can
                revisit them from the card details view.
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Done
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleIssueAnother}
                >
                  Issue Another
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
