import { ActivityDetail } from '../hooks/useActivityDetail';
import type { RelatedContractItem } from '../../../types/api';
import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';
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

interface HoldDetailsProps {
  hold: Extract<ActivityDetail, { kind: 'HOLD' }>;
  accounts: Account[];
  accountId: string;
  currentAccountNumber?: string;
  isLoadingAccounts?: boolean;
  'data-testid'?: string;
  showPayNoteHelper?: boolean;
  onViewPayNoteDetails?: () => void;
  relatedContracts?: RelatedContractItem[] | null;
  isRelatedContractsLoading?: boolean;
  relatedContractsError?: string;
}

const statusStyles: Record<
  Extract<ActivityDetail, { kind: 'HOLD' }>['status'],
  string
> = {
  PENDING: 'bg-amber-50 text-amber-700 border border-amber-100',
  PARTIALLY_CAPTURED: 'bg-lime-50 text-lime-700 border border-lime-100',
  CAPTURED: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  RELEASED: 'bg-sky-50 text-sky-700 border border-sky-100',
  EXPIRED: 'bg-slate-100 text-slate-700 border border-slate-200',
  FAILED: 'bg-rose-50 text-rose-700 border border-rose-100',
};

const timelineIcons: Record<
  Extract<ActivityDetail, { kind: 'HOLD' }>['timeline'][number]['type'],
  string
> = {
  CREATED: '⏳',
  CAPTURED: '✔',
  CAPTURED_PARTIAL: '➗',
  RELEASED: '↺',
  FAILED: '✖',
};

const formatDateTime = (value: string | undefined) => {
  if (!value) return '—';

  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
};

const findAccountName = (accounts: Account[], accountNumber?: string) => {
  if (!accountNumber) {
    return '';
  }
  return accounts.find(account => account.accountNumber === accountNumber)
    ?.name;
};

const formatAccountWithName = (
  accountNumber?: string,
  accountName?: string
): string => {
  if (!accountNumber) {
    return '—';
  }
  const formattedNumber = formatAccountNumber(accountNumber);
  return accountName ? `${formattedNumber} (${accountName})` : formattedNumber;
};

const buildCounterpartyDisplay = (
  accounts: Account[],
  accountNumber?: string,
  isLoadingAccounts?: boolean
) => {
  if (!accountNumber) {
    return '—';
  }

  const formattedNumber = formatAccountNumber(accountNumber);
  if (isLoadingAccounts) {
    return `${formattedNumber} (Loading name...)`;
  }

  const accountName = findAccountName(accounts, accountNumber);
  return accountName ? `${formattedNumber} (${accountName})` : formattedNumber;
};

type HoldStatus = Extract<ActivityDetail, { kind: 'HOLD' }>['status'];

const deriveStatus = (
  hold: Extract<ActivityDetail, { kind: 'HOLD' }>
): HoldStatus => {
  if (hold.status === 'PARTIALLY_CAPTURED') {
    return 'PARTIALLY_CAPTURED';
  }
  if (hold.failedAt || hold.status === 'FAILED') {
    return 'FAILED';
  }
  if (hold.releasedAt || hold.status === 'RELEASED') {
    return 'RELEASED';
  }
  if (hold.capturedAt || hold.status === 'CAPTURED') {
    return 'CAPTURED';
  }
  if (hold.status === 'EXPIRED') {
    return 'EXPIRED';
  }
  return 'PENDING';
};

const formatStatusLabel = (status: HoldStatus) => {
  switch (status) {
    case 'PARTIALLY_CAPTURED':
      return 'Partially captured';
    case 'CAPTURED':
      return 'Captured';
    case 'RELEASED':
      return 'Released';
    case 'FAILED':
      return 'Failed';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Pending';
  }
};

const formatContractStatus = (value?: string) => {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const contractStatusStyles: Record<string, string> = {
  accepted: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-100',
  pending: 'bg-amber-50 text-amber-700 border border-amber-100',
  bootstrapped: 'bg-sky-50 text-sky-700 border border-sky-100',
};

export function HoldDetails({
  hold,
  accounts,
  accountId,
  currentAccountNumber,
  isLoadingAccounts,
  'data-testid': testId,
  showPayNoteHelper = false,
  onViewPayNoteDetails,
  relatedContracts,
  isRelatedContractsLoading = false,
  relatedContractsError,
}: HoldDetailsProps) {
  const { setActiveSession } = useActiveContractSession();
  const formattedAmount = formatCurrency(hold.amountMinor);
  const timeline = [...hold.timeline].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  const currentAccount =
    accounts.find(account => account.accountId === accountId) ??
    accounts.find(account => account.accountNumber === currentAccountNumber);

  const currentAccountDisplay = formatAccountWithName(
    currentAccountNumber ?? currentAccount?.accountNumber,
    currentAccount?.name
  );

  const counterpartyDisplay = buildCounterpartyDisplay(
    accounts,
    hold.counterpartyAccountNumber,
    isLoadingAccounts
  );

  const displayStatus = deriveStatus(hold);
  const isCardHold = Boolean(
    hold.cardLast4 || hold.merchantName || hold.processorChargeId
  );
  const methodLabel = isCardHold
    ? 'Card Authorization'
    : showPayNoteHelper
    ? 'PayNote Transfer'
    : 'Standard Transfer';

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

  const detailRows: Array<{ label: string; value: string }> = [
    { label: 'Method', value: methodLabel },
    { label: 'From account', value: currentAccountDisplay },
    { label: 'To account', value: counterpartyDisplay },
    { label: 'Amount', value: formattedAmount },
    { label: 'Hold created', value: formatDateTime(hold.createdAt) },
  ];

  if (displayStatus !== 'PENDING') {
    if (typeof hold.capturedAmountMinor === 'number') {
      detailRows.push({
        label: 'Captured amount',
        value: formatCurrency(hold.capturedAmountMinor),
      });
    }
    if (typeof hold.remainingAmountMinor === 'number') {
      detailRows.push({
        label: 'Remaining amount',
        value: formatCurrency(hold.remainingAmountMinor),
      });
    }
  }

  if (isCardHold) {
    detailRows.push({
      label: 'Card',
      value: hold.cardLast4 ? `**** ${hold.cardLast4}` : '—',
    });
    if (hold.merchantName) {
      detailRows.push({ label: 'Merchant', value: hold.merchantName });
    }
    if (hold.merchantStatementDescriptor) {
      detailRows.push({
        label: 'Statement descriptor',
        value: hold.merchantStatementDescriptor,
      });
    }
    if (hold.processorChargeId) {
      detailRows.push({
        label: 'Processor charge',
        value: hold.processorChargeId,
      });
    }
  }

  if (hold.expiresAt) {
    detailRows.push({
      label: 'Expires',
      value: formatDateTime(hold.expiresAt),
    });
  }

  if (hold.capturedAt) {
    detailRows.push({
      label: 'Captured at',
      value: formatDateTime(hold.capturedAt),
    });
  }

  if (hold.captureTransactionId) {
    detailRows.push({
      label: 'Captured by transaction',
      value: hold.captureTransactionId,
    });
  }

  if (hold.releasedAt) {
    detailRows.push({
      label: 'Released at',
      value: formatDateTime(hold.releasedAt),
    });
  }

  if (hold.releaseReason) {
    detailRows.push({
      label: 'Release reason',
      value: hold.releaseReason,
    });
  }

  if (hold.failedAt) {
    detailRows.push({
      label: 'Failed at',
      value: formatDateTime(hold.failedAt),
    });
  }

  if (hold.failureCode || hold.failureMessage) {
    detailRows.push({
      label: 'Failure details',
      value: [hold.failureCode, hold.failureMessage]
        .filter(Boolean)
        .join(' — '),
    });
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid={testId}>
      <Card className="p-0">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Hold overview
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Hold ID: <span className="font-medium">{hold.holdId}</span>
              </p>
            </div>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusStyles[displayStatus]}`}
            >
              {formatStatusLabel(displayStatus)}
            </span>
          </div>
        </div>

        <div className="px-4 py-4 bg-white/70">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-sm text-slate-600">Amount on hold</span>
              <div className="text-3xl font-bold text-slate-900 mt-1">
                {formattedAmount}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detailRows.map(row => (
              <div key={row.label}>
                <dt className="text-sm text-slate-600">{row.label}</dt>
                <dd className="text-sm text-slate-900 mt-1">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {hold.description && (
          <div className="px-4 py-3 border-t border-slate-200">
            <h3 className="text-sm font-medium text-slate-900 mb-1">
              Description
            </h3>
            <div className="bg-white/70 rounded-lg p-3">
              <p className="text-sm text-slate-700 leading-relaxed">
                {hold.description}
              </p>
            </div>
          </div>
        )}

        {showPayNoteHelper && (
          <div className="px-4 py-3 border-t border-slate-200">
            <p className="text-sm text-slate-700">
              This transaction is part of a PayNote transfer.{' '}
              <button
                type="button"
                className="text-emerald-700 font-medium hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] rounded"
                onClick={() => onViewPayNoteDetails?.()}
              >
                See details
              </button>
            </p>
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-200">
          <h3 className="text-sm font-medium text-slate-900 mb-2">
            Related contracts
          </h3>

          {isRelatedContractsLoading && (
            <div className="flex items-center justify-center py-4">
              <Spinner size="md" color="green" />
            </div>
          )}

          {!isRelatedContractsLoading && relatedContractsError && (
            <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
              {relatedContractsError}
            </div>
          )}

          {!isRelatedContractsLoading &&
            !relatedContractsError &&
            visibleRelatedContracts.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                No related contracts found.
              </div>
            )}

          {!isRelatedContractsLoading &&
            !relatedContractsError &&
            visibleRelatedContracts.length > 0 && (
              <div className="space-y-2">
                {visibleRelatedContracts.map(contract => {
                  const isProposal = isProposalRelatedContract(contract);
                  const isSelectable = isProposal
                    ? Boolean(contract.deliverySessionId)
                    : Boolean(contract.sessionId);
                  const primaryName = isProposal
                    ? contract.name?.trim() || 'PayNote proposal'
                    : contract.documentName?.trim() || contract.displayName;
                  const statusValue = isProposal
                    ? contract.clientDecisionStatus ?? 'pending'
                    : contract.status;
                  const statusKey = statusValue?.toLowerCase() ?? '';
                  const statusStyle =
                    contractStatusStyles[statusKey] ??
                    'bg-slate-100 text-slate-700 border border-slate-200';

                  return (
                    <button
                      key={
                        isProposal
                          ? `proposal-${contract.deliveryId}`
                          : contract.contractId
                      }
                      type="button"
                      className={`w-full text-left rounded-xl border p-3 shadow-sm transition ${
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
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {primaryName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="app-chip app-chip-neutral">
                            {isProposal ? 'Proposal' : contract.displayName}
                          </span>
                          {isProposal && (
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                              Proposal
                            </span>
                          )}
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyle}`}
                          >
                            {formatContractStatus(statusValue)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
        </div>

        <div className="px-4 py-4 border-t border-slate-200">
          <h3 className="text-sm font-medium text-slate-900">Timeline</h3>
          <ol className="mt-3 space-y-3">
            {timeline.map(event => (
              <li
                key={`${event.type}-${event.at}`}
                className="flex items-start gap-3"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-lg">
                  {timelineIcons[event.type]}
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {event.type === 'CREATED' && 'Hold placed'}
                    {event.type === 'CAPTURED' && 'Hold captured'}
                    {event.type === 'CAPTURED_PARTIAL' &&
                      'Hold partially captured'}
                    {event.type === 'RELEASED' && 'Hold released'}
                    {event.type === 'FAILED' && 'Hold failed'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(event.at)}
                  </div>
                  <div className="text-sm text-slate-600 mt-1 space-y-1">
                    {event.type === 'CREATED' && (
                      <>
                        <div>From: {currentAccountDisplay}</div>
                        <div>To: {counterpartyDisplay}</div>
                        <div>Hold ID: {hold.holdId}</div>
                        {hold.cardLast4 && (
                          <div>Card: **** {hold.cardLast4}</div>
                        )}
                        {hold.merchantName && (
                          <div>Merchant: {hold.merchantName}</div>
                        )}
                      </>
                    )}
                    {event.type === 'CAPTURED' && (
                      <>
                        <div>Captured hold: {hold.holdId}</div>
                        {typeof event.amountMinor === 'number' && (
                          <div>Amount: {formatCurrency(event.amountMinor)}</div>
                        )}
                        {typeof event.remainingAmountMinor === 'number' && (
                          <div>
                            Remaining:{' '}
                            {formatCurrency(event.remainingAmountMinor)}
                          </div>
                        )}
                        <div>
                          Transaction ID:{' '}
                          {event.transactionId ?? 'Not provided'}
                        </div>
                        {event.counterpartyAccountNumber && (
                          <div>
                            To account:{' '}
                            {buildCounterpartyDisplay(
                              accounts,
                              event.counterpartyAccountNumber,
                              isLoadingAccounts
                            )}
                          </div>
                        )}
                        {hold.processorChargeId && (
                          <div>Charge: {hold.processorChargeId}</div>
                        )}
                      </>
                    )}
                    {event.type === 'CAPTURED_PARTIAL' && (
                      <>
                        <div>Captured hold: {hold.holdId}</div>
                        <div>Amount: {formatCurrency(event.amountMinor)}</div>
                        <div>
                          Remaining:{' '}
                          {formatCurrency(event.remainingAmountMinor)}
                        </div>
                        <div>
                          Transaction ID:{' '}
                          {event.transactionId ?? 'Not provided'}
                        </div>
                        {event.counterpartyAccountNumber && (
                          <div>
                            To account:{' '}
                            {buildCounterpartyDisplay(
                              accounts,
                              event.counterpartyAccountNumber,
                              isLoadingAccounts
                            )}
                          </div>
                        )}
                        {hold.processorChargeId && (
                          <div>Charge: {hold.processorChargeId}</div>
                        )}
                      </>
                    )}
                    {event.type === 'RELEASED' && (
                      <>
                        <div>Hold ID: {hold.holdId}</div>
                        <div>
                          Reason: {event.reason ? event.reason : 'Not provided'}
                        </div>
                      </>
                    )}
                    {event.type === 'FAILED' && (
                      <>
                        <div>Code: {event.code}</div>
                        {event.message && <div>{event.message}</div>}
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </div>
  );
}
