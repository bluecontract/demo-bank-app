import { useState } from 'react';
import { TransactionItem } from './TransactionItem';
import { TransactionDetailsModal } from './TransactionDetailsModal';
import { ActivityItem } from '../hooks/useActivity';
import { Spinner } from '../../../ui/Spinner';
import { Account } from '../../../types/api';

interface TransactionListProps {
  activityItems: ActivityItem[];
  accountId: string;
  currentAccountNumber?: string;
  accounts?: Account[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  'data-testid'?: string;
}

export function TransactionList({
  activityItems,
  accountId,
  currentAccountNumber,
  accounts = [],
  isLoading,
  isError,
  isEmpty,
  'data-testid': testId,
}: TransactionListProps) {
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);

  const handleTransactionClick = (txnId: string) => {
    setSelectedTxnId(txnId);
  };

  const handleCloseModal = () => {
    setSelectedTxnId(null);
  };
  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-2 text-sm text-gray-600">
            Loading account activity...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center text-gray-500">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Warning">
              ⚠️
            </span>
          </div>
          <div className="text-xl mb-2">Failed to load account activity</div>
          <p className="text-sm">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid={testId}
      >
        <div className="text-center text-gray-500">
          <div className="text-6xl mb-4">
            <span role="img" aria-label="Clipboard">
              📋
            </span>
          </div>
          <div className="text-xl mb-2">No activity yet</div>
          <p className="text-sm">
            Account activity will appear here once you post a transaction or
            create a hold.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0" data-testid={testId}>
        <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-gray-200">
          <div className="divide-y divide-gray-100">
            {activityItems.map(item => {
              const key =
                item.kind === 'POSTED_TRANSACTION'
                  ? `txn-${item.transactionId}`
                  : `hold-${item.holdId}`;

              return (
                <TransactionItem
                  key={key}
                  item={item}
                  onTransactionClick={handleTransactionClick}
                  data-testid={`activity-item-${key}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {selectedTxnId && (
        <TransactionDetailsModal
          isOpen={!!selectedTxnId}
          onClose={handleCloseModal}
          accountId={accountId}
          txnId={selectedTxnId}
          currentAccountNumber={currentAccountNumber}
          accounts={accounts}
        />
      )}
    </>
  );
}
