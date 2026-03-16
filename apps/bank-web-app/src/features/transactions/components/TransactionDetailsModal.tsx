import type { MouseEvent } from 'react';
import { TransactionDetailsPanel } from './TransactionDetailsPanel';
import { ActivityItem } from '../hooks/useActivity';
import { Account } from '../../../types/api';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountNumber?: string;
  activityId: string;
  selectedActivity?: ActivityItem;
  currentAccountNumber?: string;
  accounts?: Account[];
}

const resolveHeader = (activity?: ActivityItem, activityId?: string) => {
  if (activity?.kind.startsWith('HOLD')) {
    return 'Hold Details';
  }
  if (activityId?.startsWith('HOLD')) {
    return 'Hold Details';
  }
  return 'Transaction Details';
};

export function TransactionDetailsModal({
  isOpen,
  onClose,
  accountId,
  accountNumber,
  activityId,
  selectedActivity,
  currentAccountNumber,
  accounts,
}: TransactionDetailsModalProps) {
  if (!isOpen) return null;

  const headerLabel = resolveHeader(selectedActivity, activityId);

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

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
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {headerLabel}
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
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

          <TransactionDetailsPanel
            accountId={accountId}
            accountNumber={accountNumber}
            activityId={activityId}
            selectedActivity={selectedActivity}
            currentAccountNumber={currentAccountNumber}
            accounts={accounts}
            isActive={isOpen}
            onClose={onClose}
            closeLabel="Close"
            showFooterAction
          />
        </div>
      </div>
    </div>
  );
}
