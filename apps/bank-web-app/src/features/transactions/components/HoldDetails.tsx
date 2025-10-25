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

interface HoldDetailsProps {
  hold: Extract<ActivityDetail, { kind: 'HOLD' }>;
  accounts: Account[];
  isLoadingAccounts?: boolean;
  'data-testid'?: string;
}

const statusStyles: Record<
  Extract<ActivityDetail, { kind: 'HOLD' }>['status'],
  string
> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CAPTURED: 'bg-green-100 text-green-800',
  RELEASED: 'bg-blue-100 text-blue-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
  FAILED: 'bg-red-100 text-red-800',
};

const timelineIcons: Record<
  Extract<ActivityDetail, { kind: 'HOLD' }>['timeline'][number]['type'],
  string
> = {
  CREATED: '⏳',
  CAPTURED: '✔',
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

export function HoldDetails({
  hold,
  accounts,
  isLoadingAccounts,
  'data-testid': testId,
}: HoldDetailsProps) {
  const formattedAmount = formatCurrency(hold.amountMinor);
  const timeline = [...hold.timeline].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  const detailRows: Array<{ label: string; value: string }> = [
    { label: 'Amount', value: formattedAmount },
    {
      label: 'Counterparty',
      value: buildCounterpartyDisplay(
        accounts,
        hold.counterpartyAccountNumber,
        isLoadingAccounts
      ),
    },
    { label: 'Created', value: formatDateTime(hold.createdAt) },
    { label: 'Expires', value: formatDateTime(hold.expiresAt) },
    {
      label: 'Captured',
      value:
        hold.capturedAt && hold.captureTransactionId
          ? `${formatDateTime(hold.capturedAt)} • Txn: ${
              hold.captureTransactionId
            }`
          : formatDateTime(hold.capturedAt),
    },
    {
      label: 'Released',
      value: hold.releasedAt
        ? `${formatDateTime(hold.releasedAt)}${
            hold.releaseReason ? ` • Reason: ${hold.releaseReason}` : ''
          }`
        : '—',
    },
    {
      label: 'Failed',
      value: hold.failedAt
        ? `${formatDateTime(hold.failedAt)}${
            hold.failureCode ? ` • ${hold.failureCode}` : ''
          }${hold.failureMessage ? ` — ${hold.failureMessage}` : ''}`
        : '—',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto" data-testid={testId}>
      <Card className="p-0">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Hold overview
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Hold ID: <span className="font-medium">{hold.holdId}</span>
              </p>
            </div>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                statusStyles[hold.status]
              }`}
            >
              {hold.status}
            </span>
          </div>
        </div>

        <div className="px-4 py-4 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-sm text-gray-600">Amount on hold</span>
              <div className="text-3xl font-bold text-gray-900 mt-1">
                {formattedAmount}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detailRows.map(row => (
              <div key={row.label}>
                <dt className="text-sm text-gray-600">{row.label}</dt>
                <dd className="text-sm text-gray-900 mt-1">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {hold.description && (
          <div className="px-4 py-3 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-1">
              Description
            </h3>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 leading-relaxed">
                {hold.description}
              </p>
            </div>
          </div>
        )}

        <div className="px-4 py-4 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">Timeline</h3>
          <ol className="mt-3 space-y-3">
            {timeline.map(event => (
              <li
                key={`${event.type}-${event.at}`}
                className="flex items-start gap-3"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-lg">
                  {timelineIcons[event.type]}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {event.type === 'CREATED' && 'Hold created'}
                    {event.type === 'CAPTURED' && 'Hold captured'}
                    {event.type === 'RELEASED' && 'Hold released'}
                    {event.type === 'FAILED' && 'Hold failed'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDateTime(event.at)}
                  </div>
                  <div className="text-sm text-gray-600 mt-1 space-y-1">
                    {event.type === 'CREATED' && (
                      <>
                        {event.createdByUserId && (
                          <div>Created by: {event.createdByUserId}</div>
                        )}
                        {event.idempotencyKeyHash && (
                          <div>Idempotency: {event.idempotencyKeyHash}</div>
                        )}
                      </>
                    )}
                    {event.type === 'CAPTURED' && (
                      <>
                        <div>Transaction ID: {event.transactionId}</div>
                        {event.counterpartyAccountNumber && (
                          <div>
                            Counterparty:{' '}
                            {buildCounterpartyDisplay(
                              accounts,
                              event.counterpartyAccountNumber,
                              isLoadingAccounts
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {event.type === 'RELEASED' && event.reason && (
                      <div>Reason: {event.reason}</div>
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
