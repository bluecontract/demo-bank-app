import { ActivityDetail } from '../hooks/useActivityDetail';
import { Card } from '../../../ui/Card';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

type Account = {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

interface TransactionDetailsProps {
  transaction: Extract<ActivityDetail, { kind: 'POSTED_TRANSACTION' }>;
  currentAccountId: string;
  currentAccountNumber: string;
  accounts: Account[];
  'data-testid'?: string;
  showPayNoteHelper?: boolean;
  onViewPayNoteDetails?: () => void;
}

export function TransactionDetails({
  transaction,
  currentAccountId,
  currentAccountNumber,
  accounts,
  'data-testid': testId,
  showPayNoteHelper = false,
  onViewPayNoteDetails,
}: TransactionDetailsProps) {
  const getTransactionDirection = () => {
    return transaction.side === 'CREDIT' ? 'Incoming' : 'Outgoing';
  };

  const getAccountNameByNumber = (accountNumber: string): string => {
    const account = accounts.find(acc => acc.accountNumber === accountNumber);
    return account?.name || '';
  };

  const getCurrentAccountName = (): string => {
    const account = accounts.find(acc => acc.accountId === currentAccountId);
    return account?.name || '';
  };

  const formatAccountWithName = (
    accountNumber?: string,
    accountName?: string
  ): string => {
    if (!accountNumber) {
      return '—';
    }
    const formattedNumber = formatAccountNumber(accountNumber);
    return accountName
      ? `${formattedNumber} (${accountName})`
      : formattedNumber;
  };

  const isCredit = getTransactionDirection() === 'Incoming';
  const amount = transaction.amountMinor;
  const formattedAmount = formatCurrency(amount);
  const displayAmount = isCredit
    ? `+${formattedAmount}`
    : `-${formattedAmount}`;
  const counterpartyAccountNumber =
    transaction.counterpartyAccountNumber ?? null;
  const counterpartyAccountName = counterpartyAccountNumber
    ? getAccountNameByNumber(counterpartyAccountNumber)
    : '';
  const currentAccountName = getCurrentAccountName();
  const methodLabel = showPayNoteHelper
    ? 'PayNote Transfer'
    : 'Standard Transfer';

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
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="mb-1">
            <h1 className="text-lg font-semibold text-gray-900">
              {getTransactionDirection()} transfer
            </h1>
          </div>
          {counterpartyAccountNumber && (
            <p className="text-sm text-gray-600">
              {isCredit ? 'From' : 'To'}{' '}
              {formatAccountWithName(
                counterpartyAccountNumber,
                counterpartyAccountName
              )}
            </p>
          )}
        </div>

        <div className="px-4 py-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">
              {formatDate(transaction.postedAt)}
            </span>
            <span className={getStatusBadge(transaction.status)}>
              {getDisplayStatus(transaction.status)}
            </span>
          </div>

          <div className="flex items-center mb-3">
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
                {formatAccountWithName(
                  currentAccountNumber,
                  currentAccountName
                )}
                <br />
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Operation</span>
              <span className="text-sm text-gray-900">
                {getTransactionDirection()} transfer
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Method</span>
              <span className="text-sm text-gray-900">{methodLabel}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">To account</span>
              <span className="text-sm text-gray-900">
                {isCredit
                  ? formatAccountNumber(currentAccountNumber)
                  : counterpartyAccountNumber
                  ? formatAccountNumber(counterpartyAccountNumber)
                  : '—'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">From account</span>
              <span className="text-sm text-gray-900">
                {isCredit
                  ? counterpartyAccountNumber
                    ? formatAccountNumber(counterpartyAccountNumber)
                    : '—'
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
                {formatDate(transaction.postedAt)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Payment number</span>
              <span className="text-sm text-gray-900">
                {transaction.transactionId}
              </span>
            </div>
          </div>
        </div>

        {transaction.description && (
          <div className="px-4 py-3 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-1">
              Description
            </h3>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 leading-relaxed">
                {transaction.description}
              </p>
            </div>
          </div>
        )}

        {showPayNoteHelper && (
          <div className="px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-700">
              This transaction is part of a PayNote transfer.{' '}
              <button
                type="button"
                className="text-green-700 font-medium hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
                onClick={() => onViewPayNoteDetails?.()}
              >
                See details
              </button>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
