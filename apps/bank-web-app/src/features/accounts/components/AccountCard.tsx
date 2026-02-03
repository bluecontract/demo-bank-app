import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Tooltip } from '../../../ui/Tooltip';
import { formatCurrency, formatAccountNumber } from '../../../lib';
import { Account } from '../../../types/api';

interface AccountCardProps {
  account: Account;
  isSelected?: boolean;
  onDetailsClick?: (accountId: string) => void;
  onTransferClick?: (accountId: string) => void;
  onFundClick?: (accountId: string) => void;
  onEditCreditLimitClick?: (accountId: string) => void;
}

export function AccountCard({
  account,
  isSelected = false,
  onDetailsClick,
  onTransferClick,
  onFundClick,
  onEditCreditLimitClick,
}: AccountCardProps) {
  const isCreditLine = account.accountType === 'CREDIT_LINE';

  const handleDetailsClick = () => {
    onDetailsClick?.(account.accountId);
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
    ? 'ring-2 ring-[rgba(43,190,156,0.35)] bg-white'
    : 'hover:shadow-md';

  return (
    <Card className={`${cardClassName} p-4 flex flex-col gap-3 min-h-[208px]`}>
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
            {onEditCreditLimitClick && (
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
        ) : onFundClick ? (
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

        <div className="mt-auto flex gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={event => {
              event.stopPropagation();
              handleDetailsClick();
            }}
            className="flex-1"
          >
            Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={event => {
              event.stopPropagation();
              handleTransferClick();
            }}
            className="flex-1 whitespace-nowrap"
          >
            Transfer
          </Button>
        </div>
      </div>
    </Card>
  );
}
