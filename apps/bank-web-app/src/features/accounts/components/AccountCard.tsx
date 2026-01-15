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
}

export function AccountCard({
  account,
  isSelected = false,
  onDetailsClick,
  onTransferClick,
  onFundClick,
}: AccountCardProps) {
  const handleDetailsClick = () => {
    onDetailsClick?.(account.accountId);
  };

  const handleTransferClick = () => {
    onTransferClick?.(account.accountId);
  };

  const handleFundClick = () => {
    onFundClick?.(account.accountId);
  };

  const cardClassName = isSelected
    ? 'ring-2 ring-[rgba(43,190,156,0.35)] bg-white'
    : 'hover:shadow-md';

  return (
    <Card className={cardClassName}>
      <div className="space-y-4">
        {/* Account Name and Fund Button */}
        <div className="flex items-start justify-between">
          <div className="flex-1 mr-2 min-w-0">
            <Tooltip content={account.name} position="top">
              <h3 className="text-lg font-semibold text-slate-900 truncate">
                {account.name}
              </h3>
            </Tooltip>
            <p className="account-number mt-2">
              {formatAccountNumber(account.accountNumber)}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleFundClick}
            className="px-3 whitespace-normal leading-tight text-sm py-2 mt-1"
          >
            Fund Account
          </Button>
        </div>

        {/* Balance */}
        <div className="balance-display text-slate-900">
          {formatCurrency(account.availableBalanceMinor)}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleDetailsClick}
            className="flex-[0.4]"
          >
            Details
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={handleTransferClick}
            className="flex-[0.6] whitespace-nowrap"
          >
            New transfer
          </Button>
        </div>
      </div>
    </Card>
  );
}
