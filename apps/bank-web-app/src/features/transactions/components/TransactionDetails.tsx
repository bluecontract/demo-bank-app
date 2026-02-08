import { ActivityDetail } from '../hooks/useActivityDetail';
import type { RelatedContractItem } from '../../../types/api';
import { Card } from '../../../ui/Card';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';
import { formatShortDate } from '../../../lib/formatDate';
import { Spinner } from '../../../ui/Spinner';
import { navigateTo } from '../../../lib/navigation';
import { useActiveContractSession } from '../../contracts/hooks';
import {
  getRelatedContractTarget,
  getRelatedContractSessionId,
  getVisibleRelatedContracts,
  isProposalRelatedContract,
} from '../lib/relatedContracts';

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
  userEmail?: string;
  'data-testid'?: string;
  relatedContracts?: RelatedContractItem[] | null;
  isRelatedContractsLoading?: boolean;
  relatedContractsError?: string;
}

const formatStatusText = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const getRelatedContractName = (contract: RelatedContractItem): string => {
  if (isProposalRelatedContract(contract)) {
    return contract.name?.trim() || 'PayNote proposal';
  }
  return contract.documentName?.trim() || contract.displayName;
};

const getRelatedContractPreview = (
  contract: RelatedContractItem
): string | null => {
  const summaryPreview = contract.summaryPreview?.trim();
  if (summaryPreview) {
    return summaryPreview;
  }

  if (isProposalRelatedContract(contract)) {
    if (contract.amountMinor != null) {
      const currency = contract.currency ? ` ${contract.currency}` : '';
      return `${formatCurrency(contract.amountMinor)}${currency}`;
    }
    if (contract.transactionId) {
      return `Transaction ${contract.transactionId}`;
    }
    return (
      formatStatusText(contract.clientDecisionStatus) ?? 'Proposal updated'
    );
  }

  const statusLabel = formatStatusText(contract.status);
  return statusLabel ? `Status: ${statusLabel}` : 'Contract updated';
};

export function TransactionDetails({
  transaction,
  currentAccountId,
  currentAccountNumber,
  accounts,
  userEmail,
  'data-testid': testId,
  relatedContracts,
  isRelatedContractsLoading = false,
  relatedContractsError,
}: TransactionDetailsProps) {
  const { setActiveSession } = useActiveContractSession();
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
  const isCardTransaction = Boolean(
    transaction.cardLast4 ||
      transaction.merchantName ||
      transaction.processorChargeId
  );
  const operationLabel = isCardTransaction
    ? 'Card purchase'
    : `${getTransactionDirection()} transfer`;

  const getStatusBadge = (status: string) => {
    const baseClasses =
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold';

    switch (status.toLowerCase()) {
      case 'completed':
      case 'posted':
        return `${baseClasses} bg-emerald-50 text-emerald-700 border-emerald-100`;
      case 'pending':
        return `${baseClasses} bg-amber-50 text-amber-700 border-amber-100`;
      case 'failed':
        return `${baseClasses} bg-rose-50 text-rose-700 border-rose-100`;
      default:
        return `${baseClasses} bg-slate-100 text-slate-700 border-slate-200`;
    }
  };

  const getDisplayStatus = (status: string) => {
    return status.toLowerCase() === 'posted' ? 'Completed' : status;
  };

  const { visibleRelatedContracts } =
    getVisibleRelatedContracts(relatedContracts);

  const handleContractClick = (contract: RelatedContractItem) => {
    const sessionId = getRelatedContractSessionId(contract);
    const target = getRelatedContractTarget(contract);
    if (!sessionId || !target) {
      return;
    }
    setActiveSession(sessionId);
    navigateTo(target);
  };

  const headerContext = [
    userEmail?.trim() || undefined,
    transaction.cardLast4 ? `**** ${transaction.cardLast4}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  const counterpartyDisplay = counterpartyAccountNumber
    ? formatAccountWithName(counterpartyAccountNumber, counterpartyAccountName)
    : '—';
  const currentAccountDisplay = formatAccountWithName(
    currentAccountNumber,
    currentAccountName
  );
  const fromAccountDisplay = isCredit
    ? counterpartyDisplay
    : currentAccountDisplay;
  const toAccountDisplay = isCredit
    ? currentAccountDisplay
    : counterpartyDisplay;

  const detailRows: Array<{ label: string; value: string }> = [
    { label: 'Operation', value: operationLabel },
    { label: 'From account', value: fromAccountDisplay },
    { label: 'To account', value: toAccountDisplay },
  ];

  if (isCardTransaction) {
    detailRows.push({
      label: 'Card',
      value: transaction.cardLast4 ? `**** ${transaction.cardLast4}` : '—',
    });

    if (transaction.merchantName) {
      detailRows.push({ label: 'Merchant', value: transaction.merchantName });
    }
    if (transaction.merchantStatementDescriptor) {
      detailRows.push({
        label: 'Statement descriptor',
        value: transaction.merchantStatementDescriptor,
      });
    }
    if (transaction.processorChargeId) {
      detailRows.push({
        label: 'Processor charge',
        value: transaction.processorChargeId,
      });
    }
    if (transaction.originHoldId) {
      detailRows.push({
        label: 'Authorization',
        value: transaction.originHoldId,
      });
    }
  }

  detailRows.push(
    { label: 'Amount', value: formattedAmount },
    {
      label: 'Payment creation date',
      value: formatShortDate(transaction.postedAt),
    },
    { label: 'Payment number', value: transaction.transactionId }
  );

  const statusLabel =
    transaction.status.toLowerCase() === 'pending'
      ? 'Waiting'
      : getDisplayStatus(transaction.status);

  return (
    <div className="flex flex-col gap-6 w-full" data-testid={testId}>
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
              {isCardTransaction
                ? 'Card purchase'
                : `${getTransactionDirection()} transfer`}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span className={getStatusBadge(transaction.status)}>
                {statusLabel}
              </span>
              {headerContext && (
                <span className="text-sm text-slate-500">{headerContext}</span>
              )}
            </div>
          </div>

          <div className="w-full max-w-[720px] rounded-xl border border-slate-200 bg-white/70 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>{formatShortDate(transaction.postedAt)}</span>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`flex size-8 items-center justify-center rounded-full ${
                    isCredit
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  <span className="text-lg">{isCredit ? '↓' : '↑'}</span>
                </div>
                <span className="text-3xl font-semibold text-slate-900">
                  {displayAmount}
                </span>
              </div>

              <div className="h-px bg-slate-200" />

              <div className="grid gap-3 text-sm">
                {detailRows.map(row => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4"
                  >
                    <span className="text-slate-500">{row.label}</span>
                    <span className="text-slate-900 text-right">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {transaction.description && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4">
            <h3 className="text-sm font-medium text-slate-900 mb-2">
              Description
            </h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              {transaction.description}
            </p>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Linked contracts
        </h3>

        {isRelatedContractsLoading && (
          <div className="flex items-center justify-center py-4">
            <Spinner size="md" color="green" />
          </div>
        )}

        {!isRelatedContractsLoading && relatedContractsError && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
            {relatedContractsError}
          </div>
        )}

        {!isRelatedContractsLoading &&
          !relatedContractsError &&
          visibleRelatedContracts.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
              No related contracts found.
            </div>
          )}

        {!isRelatedContractsLoading &&
          !relatedContractsError &&
          visibleRelatedContracts.length > 0 && (
            <div className="mt-4 space-y-3">
              {visibleRelatedContracts.map(contract => {
                const isProposal = isProposalRelatedContract(contract);
                const isSelectable = isProposal
                  ? Boolean(contract.deliverySessionId)
                  : Boolean(contract.sessionId);
                const primaryName = getRelatedContractName(contract);
                const preview = getRelatedContractPreview(contract);

                return (
                  <button
                    key={
                      isProposal
                        ? `proposal-${contract.deliveryId}`
                        : contract.contractId
                    }
                    type="button"
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      isSelectable
                        ? 'border-slate-200 bg-white/80 hover:border-emerald-200 hover:shadow-md'
                        : 'border-slate-200 bg-white/50 opacity-60 cursor-not-allowed'
                    }`}
                    onClick={() => {
                      if (!isSelectable) {
                        return;
                      }
                      handleContractClick(contract);
                    }}
                    disabled={!isSelectable}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {primaryName}
                      </p>
                      {preview && (
                        <p className="text-sm text-slate-600">{preview}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </Card>
    </div>
  );
}
