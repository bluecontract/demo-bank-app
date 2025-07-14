import { Transaction } from '../hooks/useTransactions';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

interface TransactionItemProps {
  transaction: Transaction;
  'data-testid'?: string;
}

export function TransactionItem({
  transaction,
  'data-testid': testId,
}: TransactionItemProps) {
  const isCredit = transaction.side === 'CREDIT';
  const formattedAmount = formatCurrency(transaction.amountMinor);
  const displayAmount = isCredit
    ? `+${formattedAmount}`
    : `-${formattedAmount}`;

  // Map transaction type to display name
  const getTransactionTypeDisplay = (type: string, side: string) => {
    switch (type) {
      case 'FUNDING':
        return 'Incoming';
      case 'TRANSFER':
        return side === 'CREDIT' ? 'Incoming' : 'Outgoing';
      case 'WITHDRAWAL':
        return 'Withdrawal';
      default:
        return type;
    }
  };

  // Format timestamp
  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const baseClasses =
      'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium';

    switch (status.toLowerCase()) {
      case 'completed':
      case 'posted':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'pending':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'failed':
        return `${baseClasses} bg-red-100 text-red-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  return (
    <div
      className="flex items-center p-4 hover:bg-gray-50 transition-colors"
      data-testid={testId}
    >
      {/* Left Section: Transaction Details */}
      <div className="flex items-center space-x-3 min-w-0 shrink-0">
        {/* Transaction Icon */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isCredit ? 'bg-green-100' : 'bg-red-100'
          }`}
        >
          <span
            className={`text-sm ${
              isCredit ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {isCredit ? '↓' : '↑'}
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={getStatusBadge(transaction.status)}>
              {transaction.status.toLowerCase() === 'posted'
                ? 'COMPLETED'
                : transaction.status}
            </span>
          </div>

          <div className="text-xs text-gray-500 whitespace-nowrap">
            {formatDate(transaction.timestamp)}
          </div>

          {transaction.counterpartyAccountNumber && (
            <div className="text-xs text-gray-500 whitespace-nowrap">
              {isCredit ? 'From' : 'To'}:{' '}
              {formatAccountNumber(transaction.counterpartyAccountNumber)}
            </div>
          )}
        </div>
      </div>

      {/* Center-Left Section: Transaction Direction */}
      <div className="ml-4 shrink-0">
        <h4 className="text-base font-medium text-gray-600 whitespace-nowrap">
          {getTransactionTypeDisplay(transaction.type, transaction.side)}
        </h4>
      </div>

      {/* Center-Right Section: Description */}
      <div className="ml-6 flex-1 min-w-0">
        {transaction.description && (
          <p className="text-base text-gray-600">{transaction.description}</p>
        )}
      </div>

      {/* Right Section: Amount */}
      <div className="ml-4 text-right shrink-0">
        <div
          className={`text-lg font-semibold ${
            isCredit ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {displayAmount}
        </div>
      </div>
    </div>
  );
}
