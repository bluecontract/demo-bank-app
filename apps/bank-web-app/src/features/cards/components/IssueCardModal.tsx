import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { useIssueCard } from '../hooks/useIssueCard';
import { IssueCardResponse } from '../../../types/api';

interface IssueCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountName: string;
}

const formatExpiry = (month: number, year: number) => {
  const monthValue = month.toString().padStart(2, '0');
  const shortYear = year.toString().slice(-2);
  return `${monthValue}/${shortYear}`;
};

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
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="issue-card-modal-backdrop"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="issue-card-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          {!issuedCard && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Issue a new card
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {accountName
                    ? `Linked to ${accountName}.`
                    : 'Select an account to continue.'}
                </p>
              </div>

              <div>
                <label
                  htmlFor="cardholderName"
                  className="block text-sm font-medium text-gray-700"
                >
                  Cardholder name (optional)
                </label>
                <input
                  id="cardholderName"
                  type="text"
                  value={cardholderName}
                  onChange={event => setCardholderName(event.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
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
                  onClick={handleClose}
                  disabled={issueCard.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
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
                <h3 className="text-lg font-semibold text-gray-900">
                  Card issued successfully
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  These details are shown once. Copy them now.
                </p>
              </div>

              <div className="rounded-xl bg-gradient-to-br from-green-500 to-yellow-400 text-white p-5">
                <div className="text-sm uppercase tracking-widest text-white/80">
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
                    <div className="text-white/70">Expiry</div>
                    <div
                      className="font-medium"
                      data-testid="issued-card-expiry"
                    >
                      {formatExpiry(
                        issuedCard.expiryMonth,
                        issuedCard.expiryYear
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/70">CVC</div>
                    <div className="font-medium" data-testid="issued-card-cvc">
                      {issuedCard.cvc}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                Store this card securely. For security, the full number and CVC
                will not be shown again.
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
