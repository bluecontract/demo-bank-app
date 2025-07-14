import { TransactionDetails as TransactionDetailsType } from '../hooks/useTransaction';
import { Card } from '../../../ui/Card';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

interface TransactionDetailsProps {
  transaction: TransactionDetailsType;
  currentAccountId: string;
  currentAccountNumber: string;
  'data-testid'?: string;
}

export function TransactionDetails({
  transaction,
  currentAccountId,
  currentAccountNumber,
  'data-testid': testId,
}: TransactionDetailsProps) {
  const getTransactionDirection = () => {
    return transaction.side === 'CREDIT' ? 'Incoming' : 'Outgoing';
  };

  const isCredit = getTransactionDirection() === 'Incoming';
  const amount = transaction.amountMinor;
  const formattedAmount = formatCurrency(amount);
  const displayAmount = isCredit
    ? `+${formattedAmount}`
    : `-${formattedAmount}`;
  const counterpartyAccountNumber = transaction.counterpartyAccountNumber;

  const getStatusBadge = (status: string) => {
    const baseClasses =
      'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium';

    switch (status.toLowerCase()) {
      case 'completed':
      case 'posted':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'pending':
        return `${baseClasses} bg-orange-100 text-orange-800`;
      case 'failed':
        return `${baseClasses} bg-red-100 text-red-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const getDisplayStatus = (status: string) => {
    return status.toLowerCase() === 'posted' ? 'Completed' : status;
  };

  return (
    <div className="max-w-2xl mx-auto" data-testid={testId}>
      <Card className="p-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="mb-2">
            <h1 className="text-xl font-semibold text-gray-900">
              {getTransactionDirection()} transfer
            </h1>
          </div>
          {counterpartyAccountNumber && (
            <p className="text-sm text-gray-600">
              {isCredit ? 'From' : 'To'}{' '}
              {formatAccountNumber(counterpartyAccountNumber)}
            </p>
          )}
        </div>

        {/* Transaction Summary */}
        <div className="px-6 py-6 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-600">
              {formatDate(transaction.timestamp)}
            </span>
            <span className={getStatusBadge(transaction.status)}>
              {getDisplayStatus(transaction.status)}
            </span>
          </div>

          <div className="flex items-center mb-4">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                isCredit ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              <span
                className={`text-lg ${
                  isCredit ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {isCredit ? '↓' : '↑'}
              </span>
            </div>
            <span className="text-3xl font-bold text-gray-900">
              {displayAmount}
            </span>
          </div>

          <div className="text-sm text-gray-600">
            {counterpartyAccountNumber && (
              <>
                {isCredit ? 'To' : 'From'}:{' '}
                {formatAccountNumber(currentAccountNumber)}
                <br />
              </>
            )}
          </div>
        </div>

        {/* Transaction Details */}
        <div className="px-6 py-6">
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Operation</span>
              <span className="text-sm text-gray-900">
                {getTransactionDirection()} transfer
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Method</span>
              <span className="text-sm text-gray-900">Standard Transfer</span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">To account</span>
              <span className="text-sm text-gray-900">
                {isCredit
                  ? formatAccountNumber(currentAccountNumber)
                  : formatAccountNumber(counterpartyAccountNumber)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">From account</span>
              <span className="text-sm text-gray-900">
                {isCredit
                  ? formatAccountNumber(counterpartyAccountNumber)
                  : formatAccountNumber(currentAccountNumber)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Amount</span>
              <span className="text-sm text-gray-900">{formattedAmount}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">
                Payment creation date
              </span>
              <span className="text-sm text-gray-900">
                {formatDate(transaction.timestamp)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Payment number</span>
              <span className="text-sm text-gray-900">{transaction.txnId}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        {transaction.description && (
          <div className="px-6 py-4 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              Description
            </h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                {transaction.description}
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
