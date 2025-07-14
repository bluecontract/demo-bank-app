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
    ? 'p-6 border-2 border-blue-300 bg-blue-50'
    : 'p-6 border-2 border-transparent';

  return (
    <Card className={cardClassName}>
      <div className="space-y-4">
        {/* Account Name and Fund Button */}
        <div className="flex items-start justify-between">
          <div className="flex-1 mr-2 min-w-0">
            <Tooltip content={account.name} position="top">
              <h3 className="text-lg font-semibold text-gray-900 truncate">
                {account.name}
              </h3>
            </Tooltip>
            <p className="account-number text-sm text-gray-600 mt-1">
              {formatAccountNumber(account.accountNumber)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFundClick}
            className="px-2 w-[100px] whitespace-normal leading-tight text-sm py-2 mt-1"
          >
            Fund Account
          </Button>
        </div>

        {/* Balance */}
        <div className="balance-display text-green-600">
          {formatCurrency(account.availableBalanceMinor)}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="gradient"
            size="md"
            onClick={handleDetailsClick}
            className="!text-green-700 hover:!text-white flex-[0.4]"
          >
            Details
          </Button>
          <Button
            variant="outline"
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
