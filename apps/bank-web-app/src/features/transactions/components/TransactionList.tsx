import { useState } from 'react';
import { TransactionItem } from './TransactionItem';
import { TransactionDetailsModal } from './TransactionDetailsModal';
import { Transaction } from '../hooks/useTransactions';
import { Spinner } from '../../../ui/Spinner';
import { Account } from '../../../types/api';

interface TransactionListProps {
  transactions: Transaction[];
  accountId: string;
  currentAccountNumber?: string;
  accounts?: Account[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  'data-testid'?: string;
}

export function TransactionList({
  transactions,
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
          <p className="mt-2 text-sm text-gray-600">Loading transactions...</p>
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
          <div className="text-6xl mb-4">⚠️</div>
          <div className="text-xl mb-2">Failed to load transactions</div>
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
          <div className="text-6xl mb-4">📋</div>
          <div className="text-xl mb-2">No transactions yet</div>
          <p className="text-sm">
            Your transaction history will appear here once you make your first
            transfer
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
            {transactions.map(transaction => (
              <TransactionItem
                key={transaction.txnId}
                transaction={transaction}
                accountId={accountId}
                onTransactionClick={handleTransactionClick}
                data-testid={`transaction-item-${transaction.txnId}`}
              />
            ))}
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
