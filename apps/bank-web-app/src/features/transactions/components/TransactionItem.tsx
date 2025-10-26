import { ActivityItem, PostedTransactionActivity } from '../hooks/useActivity';
import { formatCurrency } from '../../../lib/formatCurrency';
import { formatAccountNumber } from '../../../lib/formatAccountNumber';

const formatDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
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

const buildVisualState = (item: ActivityItem): VisualState => {
  if (item.kind === 'POSTED_TRANSACTION') {
    const isCredit = item.side === 'CREDIT';
    const amount = formatCurrency(item.amountMinor);

    return {
      badgeLabel:
        item.status.toLowerCase() === 'posted'
          ? 'COMPLETED'
          : item.status.toUpperCase(),
      badgeClass:
        {
          posted: 'bg-green-100 text-green-800',
          completed: 'bg-green-100 text-green-800',
          pending: 'bg-yellow-100 text-yellow-800',
          failed: 'bg-red-100 text-red-800',
        }[item.status.toLowerCase()] ?? 'bg-gray-100 text-gray-800',
      icon: isCredit ? '↓' : '↑',
      iconClasses: isCredit
        ? 'bg-green-100 text-green-600'
        : 'bg-red-100 text-red-600',
      title: getTransactionTypeDisplay(item.type, item.side),
      timestamp: item.postedAt,
      subtitleLines: item.counterpartyAccountNumber
        ? [
            formatCounterpartyLine(
              isCredit ? 'From' : 'To',
              item.counterpartyAccountNumber
            ),
          ]
        : [],
      description: item.description,
      amountText: `${isCredit ? '+' : '-'}${amount}`,
      amountClass: isCredit ? 'text-green-600' : 'text-red-600',
      clickable: true,
      activityId: item.activityId,
    };
  }

  const counterpartyAccountNumber =
    'counterpartyAccountNumber' in item
      ? item.counterpartyAccountNumber
      : undefined;

  const base = {
    subtitleLines: counterpartyAccountNumber
      ? [
          formatCounterpartyLine(
            getHoldDirectionLabel(),
            counterpartyAccountNumber
          ),
        ]
      : [],
    description: item.description,
    amountText: formatCurrency(item.amountMinor),
  };

  switch (item.kind) {
    case 'HOLD_CREATED':
      return {
        ...base,
        badgeLabel: 'HOLD PLACED',
        badgeClass: 'bg-yellow-100 text-yellow-800',
        icon: '⏳',
        iconClasses: 'bg-yellow-50 text-yellow-700',
        title: 'Hold Created',
        timestamp: item.createdAt,
        amountClass: 'text-yellow-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_CAPTURED':
      return {
        ...base,
        badgeLabel: 'HOLD CAPTURED',
        badgeClass: 'bg-green-100 text-green-800',
        icon: '✔',
        iconClasses: 'bg-green-50 text-green-700',
        title: 'Hold Captured',
        timestamp: item.capturedAt,
        subtitleLines: item.transactionId
          ? [...base.subtitleLines, `txn: ${item.transactionId}`]
          : base.subtitleLines,
        amountClass: 'text-yellow-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_RELEASED':
      return {
        ...base,
        badgeLabel: 'HOLD RELEASED',
        badgeClass: 'bg-blue-100 text-blue-800',
        icon: '↺',
        iconClasses: 'bg-blue-50 text-blue-700',
        title: 'Hold Released',
        timestamp: item.releasedAt,
        subtitleLines: item.releaseReason
          ? [...base.subtitleLines, `Reason: ${item.releaseReason}`]
          : base.subtitleLines,
        amountClass: 'text-blue-700',
        clickable: true,
        activityId: item.activityId,
      };
    case 'HOLD_FAILED':
      return {
        ...base,
        badgeLabel: 'HOLD FAILED',
        badgeClass: 'bg-red-100 text-red-800',
        icon: '✖',
        iconClasses: 'bg-red-50 text-red-700',
        title: 'Hold Failed',
        timestamp: item.failedAt,
        subtitleLines: [`Failure: ${item.failureCode}`],
        description: item.failureMessage ?? base.description,
        amountClass: 'text-red-700',
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

  const handleClick = () => {
    if (visualState.clickable) {
      onActivitySelect(item);
    }
  };

  return (
    <div
      className={`flex items-center p-4 transition-colors ${
        visualState.clickable ? 'cursor-pointer hover:bg-gray-50' : ''
      }`}
      onClick={visualState.clickable ? handleClick : undefined}
      data-testid={testId}
    >
      {/* Left Section */}
      <div className="flex items-center space-x-3 min-w-[350px] shrink-0">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${visualState.iconClasses}`}
        >
          {visualState.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${visualState.badgeClass}`}
            >
              {visualState.badgeLabel}
            </span>
          </div>
          <div className="text-xs text-gray-500 whitespace-nowrap">
            {formatDate(visualState.timestamp)}
          </div>
          {visualState.subtitleLines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              className="text-xs text-gray-500 whitespace-nowrap"
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Middle Section */}
      <div className="ml-4 shrink-0">
        <h4 className="text-base font-medium text-gray-600 whitespace-nowrap">
          {visualState.title}
        </h4>
      </div>

      {/* Description */}
      <div className="ml-6 flex-1 min-w-0">
        {visualState.description && (
          <p className="text-base text-gray-600">{visualState.description}</p>
        )}
      </div>

      {/* Amount */}
      <div className="ml-4 text-right shrink-0">
        <div className={`text-lg font-semibold ${visualState.amountClass}`}>
          {visualState.amountText}
        </div>
      </div>
    </div>
  );
}
