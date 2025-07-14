import { TransactionDetails } from './TransactionDetails';
import { useTransaction } from '../hooks/useTransaction';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import { Account } from '../../../types/api';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  txnId: string;
  currentAccountNumber?: string;
  accounts?: Account[];
}

export function TransactionDetailsModal({
  isOpen,
  onClose,
  accountId,
  txnId,
  currentAccountNumber,
  accounts: propAccounts,
}: TransactionDetailsModalProps) {
  const {
    data: transaction,
    isLoading,
    isError,
  } = useTransaction({
    accountId,
    txnId,
  });

  const { data: fetchedAccounts } = useAccounts();
  const accounts = propAccounts || fetchedAccounts || [];

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="transaction-modal-backdrop"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="transaction-modal-content"
        role="dialog"
        aria-modal="true"
      >
        {isLoading && (
          <div className="p-8 text-center">
            <Spinner size="lg" color="green" />
            <p className="mt-4 text-gray-600">Loading transaction details...</p>
          </div>
        )}

        {isError && (
          <div className="p-8 text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Transaction Not Found
            </h2>
            <p className="text-gray-600 mb-6">
              The transaction you're looking for could not be found.
            </p>
            <Button onClick={onClose}>Close</Button>
          </div>
        )}

        {transaction && (
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900">
                Transaction Details
              </h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close modal"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <TransactionDetails
              transaction={transaction}
              currentAccountId={accountId}
              currentAccountNumber={currentAccountNumber || accountId}
              accounts={accounts || []}
              data-testid="modal-transaction-details"
            />

            <div className="mt-3 pt-2 border-t border-gray-200">
              <Button onClick={onClose} variant="primary" className="w-full">
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
