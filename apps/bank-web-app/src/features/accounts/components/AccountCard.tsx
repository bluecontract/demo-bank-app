import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Tooltip } from '../../../ui/Tooltip';
import { formatCurrency, formatAccountNumber } from '../../../lib';
import { Account } from '../../../types/api';
import {
  ACCOUNT_CARD_HEIGHT_CLASSES,
  ACCOUNT_CARD_SELECTED_RING_CLASS,
} from './accountCardStyles';

interface AccountCardProps {
  account: Account;
  isSelected?: boolean;
  showActions?: boolean;
  size?: 'default' | 'compact';
  onSelect?: (accountId: string) => void;
  onTransferClick?: (accountId: string) => void;
  onFundClick?: (accountId: string) => void;
  onEditCreditLimitClick?: (accountId: string) => void;
}

export function AccountCard({
  account,
  isSelected = false,
  showActions = true,
  size = 'default',
  onSelect,
  onTransferClick,
  onFundClick,
  onEditCreditLimitClick,
}: AccountCardProps) {
  const isCreditLine = account.accountType === 'CREDIT_LINE';
  const isSelectable = Boolean(onSelect);

  const handleSelect = () => {
    onSelect?.(account.accountId);
  };

  const handleTransferClick = () => {
    onTransferClick?.(account.accountId);
  };

  const handleFundClick = () => {
    onFundClick?.(account.accountId);
  };

  const handleEditCreditLimitClick = () => {
    onEditCreditLimitClick?.(account.accountId);
  };

  const cardClassName = isSelected
    ? ACCOUNT_CARD_SELECTED_RING_CLASS
    : 'sm:hover:shadow-md';
  const heightClass = ACCOUNT_CARD_HEIGHT_CLASSES[size];
  const radiusClass =
    size === 'compact' ? 'rounded-lg' : 'rounded-lg sm:rounded-2xl';

  return (
    <Card
      className={`${cardClassName} ${heightClass} ${radiusClass} p-4 flex flex-col gap-3 shadow-none sm:shadow-[var(--shadow-soft)]`}
      onClick={isSelectable ? handleSelect : undefined}
      role={isSelectable ? 'button' : undefined}
      tabIndex={isSelectable ? 0 : undefined}
      aria-pressed={isSelectable ? isSelected : undefined}
      aria-label={isSelectable ? `Select ${account.name}` : undefined}
      onKeyDown={
        isSelectable
          ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSelect();
              }
            }
          : undefined
      }
    >
      <div className="flex flex-col gap-3 h-full">
        <div className="min-w-0">
          <Tooltip content={account.name} position="top">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {account.name}
            </h3>
          </Tooltip>
          <p className="account-number mt-1 text-xs text-slate-500">
            {formatAccountNumber(account.accountNumber)}
          </p>
        </div>

        <div className="balance-display text-slate-900">
          {formatCurrency(account.availableBalanceMinor)}
        </div>

        {isCreditLine ? (
          <div className="flex items-center justify-between text-xs text-slate-500">
            {account.creditLimitMinor !== undefined && (
              <span>Limit: {formatCurrency(account.creditLimitMinor)}</span>
            )}
            {showActions && onEditCreditLimitClick && (
              <button
                type="button"
                className="font-semibold text-[var(--color-primary)] hover:underline"
                onClick={event => {
                  event.stopPropagation();
                  handleEditCreditLimitClick();
                }}
              >
                Edit
              </button>
            )}
          </div>
        ) : showActions && onFundClick ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--color-primary)] hover:underline self-start"
            onClick={event => {
              event.stopPropagation();
              handleFundClick();
            }}
          >
            Fund
          </button>
        ) : null}

        {showActions && onTransferClick && (
          <div className="mt-auto flex">
            <Button
              variant="outline"
              size="sm"
              onClick={event => {
                event.stopPropagation();
                handleTransferClick();
              }}
              className="w-full whitespace-nowrap"
            >
              New transfer
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
