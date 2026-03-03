import { ActivityItem, PostedTransactionActivity } from '../hooks/useActivity';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

const formatDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatAbsoluteCurrency = (amountMinor: number) =>
  formatCurrency(Math.abs(amountMinor));

const capturedBadgeClass =
  'bg-[var(--color-primary-tint)] text-[var(--color-primary)] border border-[var(--color-primary)]';

const isCompletedTransactionStatus = (status: string) => {
  const normalizedStatus = status.toLowerCase();
  return normalizedStatus === 'posted' || normalizedStatus === 'completed';
};

const getTransactionTypeDisplay = (
  type: PostedTransactionActivity['type'],
  side: PostedTransactionActivity['side']
) => {
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

type VisualState = {
  badgeLabel: string;
  badgeClass: string;
  title: string;
  timestamp: string;
  subtitleLines: string[];
  description?: string;
  amountText: string;
  amountClass: string;
  clickable: boolean;
  activityId: string;
};

const formatCounterpartyLine = (
  directionLabel: 'From' | 'To',
  accountNumber: string
) => `${directionLabel}: ${formatAccountNumber(accountNumber)}`;

const getHoldDirectionLabel = (): 'From' | 'To' => 'To';

const formatCardLine = (last4?: string) =>
  last4 ? `Card: **** ${last4}` : undefined;

const formatChargeLine = (processorChargeId?: string) =>
  processorChargeId ? `Charge: ${processorChargeId}` : undefined;

const normalizeDescription = (description?: string, merchantName?: string) => {
  if (!description) {
    return undefined;
  }
  if (merchantName && description.trim() === merchantName.trim()) {
    return undefined;
  }
  return description;
};

const buildTxnListTitle = (
  baseText: string | undefined,
  merchantName?: string
): string => {
  const normalizedBase = baseText?.trim();
  const normalizedMerchant = merchantName?.trim();

  if (normalizedBase && normalizedMerchant) {
    const lowerBase = normalizedBase.toLowerCase();
    const lowerMerchant = normalizedMerchant.toLowerCase();
    if (lowerBase.includes(lowerMerchant)) {
      return normalizedBase;
    }
    return `${normalizedBase} at ${normalizedMerchant}`;
  }

  if (normalizedBase) {
    return normalizedBase;
  }

  if (normalizedMerchant) {
    return normalizedMerchant;
  }

  return 'Transaction';
};

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

const getPostedBadgeLabel = (status: string): string => {
  if (isCompletedTransactionStatus(status)) {
    return 'Captured';
  }
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'pending') {
    return 'Pending';
  }
  if (normalizedStatus === 'failed') {
    return 'Failed';
  }
  return toTitleCase(status);
};

const buildVisualState = (item: ActivityItem): VisualState => {
  const hasCardContext = Boolean(
    item.cardLast4 || item.merchantName || item.processorChargeId
  );

  const cardSubtitleLines = [
    formatCardLine(item.cardLast4),
    formatChargeLine(item.processorChargeId),
  ].filter((line): line is string => Boolean(line));

  if (item.kind === 'POSTED_TRANSACTION') {
    const isCredit = item.side === 'CREDIT';
    const amount = formatAbsoluteCurrency(item.amountMinor);
    const isOutgoingCompleted =
      !isCredit && isCompletedTransactionStatus(item.status);
    const title = hasCardContext
      ? item.merchantName ?? 'Card Purchase'
      : getTransactionTypeDisplay(item.type, item.side);

    return {
      badgeLabel: getPostedBadgeLabel(item.status),
      badgeClass:
        {
          posted: capturedBadgeClass,
          completed: capturedBadgeClass,
          pending: 'bg-amber-50 text-amber-700 border border-amber-100',
          failed: 'bg-rose-50 text-rose-700 border border-rose-100',
        }[item.status.toLowerCase()] ??
        'bg-slate-100 text-slate-700 border border-slate-200',
      title,
      timestamp: item.postedAt,
      subtitleLines: hasCardContext
        ? cardSubtitleLines
        : item.counterpartyAccountNumber
        ? [
            formatCounterpartyLine(
              isCredit ? 'From' : 'To',
              item.counterpartyAccountNumber
            ),
          ]
        : [],
      description: normalizeDescription(item.description, item.merchantName),
      amountText: isOutgoingCompleted ? `-${amount}` : amount,
      amountClass: isOutgoingCompleted
        ? 'text-[var(--color-danger)]'
        : 'text-[var(--color-ink)]',
      clickable: true,
      activityId: item.activityId,
    };
  }

  const counterpartyAccountNumber =
    'counterpartyAccountNumber' in item
      ? item.counterpartyAccountNumber
      : undefined;

  const base = {
    subtitleLines: hasCardContext
      ? cardSubtitleLines
      : counterpartyAccountNumber
      ? [
          formatCounterpartyLine(
            getHoldDirectionLabel(),
            counterpartyAccountNumber
          ),
        ]
      : [],
    description: normalizeDescription(item.description, item.merchantName),
    amountText: formatAbsoluteCurrency(item.amountMinor),
  };

  switch (item.kind) {
    case 'HOLD_CREATED':
      return {
        ...base,
        badgeLabel: 'Hold',
        badgeClass:
          'bg-[#ffefe9] text-[var(--color-accent)] border border-[var(--color-accent)]',
        title: item.merchantName ?? 'Hold Created',
        timestamp: item.createdAt,
        amountClass: 'text-[var(--color-ink)]',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_CAPTURED':
      return {
        ...base,
        badgeLabel: 'Captured',
        badgeClass: capturedBadgeClass,
        title: item.merchantName ?? 'Hold Captured',
        timestamp: item.capturedAt,
        subtitleLines: item.transactionId
          ? [...base.subtitleLines, `txn: ${item.transactionId}`]
          : base.subtitleLines,
        amountText: `-${base.amountText}`,
        amountClass: 'text-[var(--color-danger)]',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_RELEASED':
      return {
        ...base,
        badgeLabel: 'Released',
        badgeClass: 'bg-sky-50 text-sky-700 border border-sky-100',
        title: item.merchantName ?? 'Hold Released',
        timestamp: item.releasedAt,
        subtitleLines: item.releaseReason
          ? [...base.subtitleLines, `Reason: ${item.releaseReason}`]
          : base.subtitleLines,
        amountClass: 'text-[var(--color-ink)]',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_FAILED':
      return {
        ...base,
        badgeLabel: 'Failed',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-100',
        title: item.merchantName ?? 'Hold Failed',
        timestamp: item.failedAt,
        subtitleLines: [`Failure: ${item.failureCode}`],
        description: base.description,
        amountClass: 'text-[var(--color-ink)]',
        clickable: true,
        activityId: item.activityId,
      };
  }
};

interface TransactionItemProps {
  item: ActivityItem;
  onActivitySelect: (activity: ActivityItem) => void;
  variant?: 'default' | 'linked';
  'data-testid'?: string;
}

export function TransactionItem({
  item,
  onActivitySelect,
  variant = 'default',
  'data-testid': testId,
}: TransactionItemProps) {
  const visualState = buildVisualState(item);
  const counterpartyAccountNumber =
    'counterpartyAccountNumber' in item
      ? item.counterpartyAccountNumber
      : undefined;
  const primaryText = visualState.description ?? visualState.title;
  const listTitle = buildTxnListTitle(primaryText, item.merchantName);
  const cardLabel = item.cardLast4
    ? `***${item.cardLast4}`
    : counterpartyAccountNumber
    ? formatAccountNumber(counterpartyAccountNumber)
    : '—';
  const dateLabel = formatDate(visualState.timestamp);

  const handleClick = () => {
    if (visualState.clickable) {
      onActivitySelect(item);
    }
  };

  if (variant === 'linked') {
    return (
      <div
        className={`px-4 py-3 transition-colors ${
          visualState.clickable ? 'cursor-pointer hover:bg-slate-50/80' : ''
        }`}
        onClick={visualState.clickable ? handleClick : undefined}
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {listTitle}
            </p>
            <p className="mt-1 text-xs text-slate-500">{dateLabel}</p>
          </div>
          <div
            className={`text-sm font-semibold text-right ${visualState.amountClass}`}
          >
            {visualState.amountText}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-3 sm:h-12 sm:py-0 transition-colors ${
        visualState.clickable ? 'cursor-pointer' : ''
      }`}
      onClick={visualState.clickable ? handleClick : undefined}
      data-testid={testId}
    >
      <div className="grid h-full w-full items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px_minmax(0,1fr)_120px] sm:gap-4">
        <div className="min-w-0 sm:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900 truncate">
                {listTitle}
              </div>
              <div className="mt-1 flex items-center justify-between gap-4 text-xs text-slate-500">
                <span className="truncate">{cardLabel}</span>
                <span className="whitespace-nowrap">{dateLabel}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div
                className={`text-sm font-semibold ${visualState.amountClass}`}
              >
                {visualState.amountText}
              </div>
              <span
                className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${visualState.badgeClass}`}
              >
                {visualState.badgeLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="hidden sm:flex min-w-0 h-full items-center">
          <span className="block truncate text-sm font-normal leading-6 text-[color:var(--color-ink)]">
            {listTitle}
          </span>
        </div>

        <div className="hidden sm:flex min-w-0 h-full items-center">
          <span className="block truncate text-sm font-normal leading-6 text-slate-500">
            {cardLabel}
          </span>
        </div>

        <div className="hidden sm:flex min-w-0 h-full items-center justify-end">
          <span
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-[4px] border px-2 text-sm font-normal leading-6 ${visualState.badgeClass}`}
          >
            {visualState.badgeLabel}
          </span>
        </div>

        <div className="hidden sm:flex min-w-0 h-full items-center">
          <span className="block truncate text-sm font-normal leading-6 text-slate-500">
            {dateLabel}
          </span>
        </div>

        <div
          className={`hidden sm:flex h-full items-center justify-end text-right text-2xl font-[800] leading-8 font-[var(--font-title)] ${visualState.amountClass}`}
        >
          {visualState.amountText}
        </div>
      </div>
    </div>
  );
}
