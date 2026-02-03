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
  hasPayNote: boolean;
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

const PayNoteIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M5.40723 5.02246C7.37398 5.02246 9.06365 6.14809 10.0332 8.1416L14.4658 17.0488C14.5765 17.2736 14.6595 17.4344 14.7979 17.6592C15.9059 19.6849 17.402 21.164 19.3965 22H16.0166C14.0499 21.9999 12.3328 20.8744 11.3633 18.9131L7.76172 11.6465C7.29089 10.682 6.84782 9.68543 6.29395 8.81738C6.04469 8.43162 5.79549 8.04514 5.51855 7.72363V22H2V5.02246H5.40723ZM22 5.02246H20.0879C19.7004 5.02275 19.3956 5.3763 19.3955 5.82617V21.4531C18.1492 20.7136 17.2072 19.556 16.4316 18.0449L15.8779 16.8877V5.02246H18.7031C19.0909 5.02246 19.3955 4.66888 19.3955 4.21875V2H22V5.02246ZM9.39551 17.9482H6.81934V14.8945H7.87207L9.39551 17.9482Z"
      fill="currentColor"
    />
  </svg>
);

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
  const hasPayNote = Boolean(item.payNote?.payNoteDocumentId);

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
      hasPayNote,
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
    hasPayNote,
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
  'data-testid'?: string;
}

export function TransactionItem({
  item,
  onActivitySelect,
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
  const payNoteIcon = visualState.hasPayNote ? (
    <span
      className="inline-flex items-center justify-center size-6 text-[#0062ff]"
      role="img"
      aria-label="PayNote"
    >
      <PayNoteIcon />
    </span>
  ) : null;

  const handleClick = () => {
    if (visualState.clickable) {
      onActivitySelect(item);
    }
  };

  return (
    <div
      className={`px-4 py-3 transition-colors ${
        visualState.clickable ? 'cursor-pointer hover:bg-slate-50/80' : ''
      }`}
      onClick={visualState.clickable ? handleClick : undefined}
      data-testid={testId}
    >
      <div className="grid w-full items-center gap-3 md:grid-cols-[minmax(0,1fr)_140px_64px_360px_120px] md:gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-5 text-slate-700 truncate">
            {primaryText}
          </div>
          {secondaryText && (
            <div className="mt-1 text-xs text-slate-500 truncate md:hidden">
              {secondaryText}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 md:hidden">
            <span className="truncate">{cardLabel}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
            {payNoteIcon ? (
              payNoteIcon
            ) : (
              <span className="size-6" aria-hidden="true" />
            )}
            <span
              className={`inline-flex items-center justify-center min-w-[104px] px-2 py-1 rounded-full text-[11px] font-semibold ${visualState.badgeClass}`}
            >
              {visualState.badgeLabel}
            </span>
            <span className="text-sm text-slate-500 whitespace-nowrap">
              {dateLabel}
            </span>
          </div>
        </div>

        <div className="hidden md:block min-w-0 text-sm text-slate-500 text-right">
          <span className="truncate block">{cardLabel}</span>
        </div>

        <div className="hidden md:block" aria-hidden="true" />

        <div className="hidden md:grid items-center min-w-0 text-sm text-slate-500 grid-cols-[max-content_1fr] gap-x-2">
          {payNoteIcon ? (
            payNoteIcon
          ) : (
            <span className="size-6" aria-hidden="true" />
          )}
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
          className={`text-lg font-semibold md:text-right ${visualState.amountClass}`}
        >
          {visualState.amountText}
        </div>
      </div>
    </div>
  );
}
