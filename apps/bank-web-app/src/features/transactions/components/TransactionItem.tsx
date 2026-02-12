import { ActivityItem, PostedTransactionActivity } from '../hooks/useActivity';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

const formatDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

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
  icon: string;
  iconClasses: string;
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
    const amount = formatCurrency(item.amountMinor);
    const title = hasCardContext
      ? item.merchantName ?? 'Card Purchase'
      : getTransactionTypeDisplay(item.type, item.side);

    return {
      badgeLabel:
        item.status.toLowerCase() === 'posted'
          ? 'COMPLETED'
          : item.status.toUpperCase(),
      badgeClass:
        {
          posted: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
          completed: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
          pending: 'bg-amber-50 text-amber-700 border border-amber-100',
          failed: 'bg-rose-50 text-rose-700 border border-rose-100',
        }[item.status.toLowerCase()] ??
        'bg-slate-100 text-slate-700 border border-slate-200',
      icon: isCredit ? '↓' : '↑',
      iconClasses: isCredit
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-rose-50 text-rose-600',
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
      amountText: `${isCredit ? '+' : '-'}${amount}`,
      amountClass: isCredit ? 'text-emerald-600' : 'text-rose-600',
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
    amountText: formatCurrency(item.amountMinor),
  };

  switch (item.kind) {
    case 'HOLD_CREATED':
      return {
        ...base,
        badgeLabel: 'HOLD PLACED',
        badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100',
        icon: '⏳',
        iconClasses: 'bg-amber-50 text-amber-700',
        title: item.merchantName ?? 'Hold Created',
        timestamp: item.createdAt,
        amountClass: 'text-amber-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_CAPTURED':
      return {
        ...base,
        badgeLabel: 'HOLD CAPTURED',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
        icon: '✔',
        iconClasses: 'bg-emerald-50 text-emerald-700',
        title: item.merchantName ?? 'Hold Captured',
        timestamp: item.capturedAt,
        subtitleLines: item.transactionId
          ? [...base.subtitleLines, `txn: ${item.transactionId}`]
          : base.subtitleLines,
        amountText: `-${formatCurrency(item.amountMinor)}`,
        amountClass: 'text-amber-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_RELEASED':
      return {
        ...base,
        badgeLabel: 'HOLD RELEASED',
        badgeClass: 'bg-sky-50 text-sky-700 border border-sky-100',
        icon: '↺',
        iconClasses: 'bg-sky-50 text-sky-700',
        title: item.merchantName ?? 'Hold Released',
        timestamp: item.releasedAt,
        subtitleLines: item.releaseReason
          ? [...base.subtitleLines, `Reason: ${item.releaseReason}`]
          : base.subtitleLines,
        amountClass: 'text-sky-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_FAILED':
      return {
        ...base,
        badgeLabel: 'HOLD FAILED',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-100',
        icon: '✖',
        iconClasses: 'bg-rose-50 text-rose-700',
        title: item.merchantName ?? 'Hold Failed',
        timestamp: item.failedAt,
        subtitleLines: [`Failure: ${item.failureCode}`],
        description: item.failureMessage ?? base.description,
        amountClass: 'text-rose-700',
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
  const secondaryText =
    visualState.description && visualState.description !== visualState.title
      ? visualState.title
      : undefined;
  const cardLabel = item.cardLast4
    ? `**** ${item.cardLast4}`
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
              {primaryText}
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
      className={`px-4 py-3 transition-colors ${
        visualState.clickable ? 'cursor-pointer hover:bg-slate-50/80' : ''
      }`}
      onClick={visualState.clickable ? handleClick : undefined}
      data-testid={testId}
    >
      <div className="grid w-full items-center gap-3 sm:grid-cols-[minmax(0,1fr)_140px_64px_360px_120px] sm:gap-4">
        <div className="min-w-0 sm:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900 truncate">
                {primaryText}
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

        <div className="hidden sm:block min-w-0">
          <div className="text-[13px] font-medium leading-5 text-slate-700 truncate">
            {primaryText}
          </div>
          {secondaryText && (
            <div className="mt-1 text-xs text-slate-500 truncate">
              {secondaryText}
            </div>
          )}
        </div>

        <div className="hidden sm:block min-w-0 text-sm text-slate-500 text-right">
          <span className="truncate block">{cardLabel}</span>
        </div>

        <div className="hidden sm:block" aria-hidden="true" />

        <div className="hidden sm:grid items-center min-w-0 text-sm text-slate-500">
          <div className="grid grid-cols-[120px_1fr] items-center gap-x-2 min-w-0">
            <span
              className={`inline-flex items-center justify-center min-w-[104px] px-2 py-1 rounded-full text-[11px] font-semibold justify-self-start ${visualState.badgeClass}`}
            >
              {visualState.badgeLabel}
            </span>
            <span className="truncate">{dateLabel}</span>
          </div>
        </div>

        <div
          className={`hidden sm:block text-lg font-semibold text-right ${visualState.amountClass}`}
        >
          {visualState.amountText}
        </div>
      </div>
    </div>
  );
}
