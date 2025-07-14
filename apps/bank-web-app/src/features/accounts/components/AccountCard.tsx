import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { formatCurrency, formatAccountNumber } from '../../../lib';

// Define Account type based on API contract
type Account = {
  accountId: string;
  accountNumber: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

interface AccountCardProps {
  account: Account;
  accountName?: string;
  isSelected?: boolean;
  onDetailsClick?: (accountId: string) => void;
  onTransferClick?: (accountId: string) => void;
  onFundClick?: (accountId: string) => void;
}

export function AccountCard({
  account,
  accountName = 'Checking Account',
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
    : 'p-6';

  return (
    <Card className={cardClassName}>
      <div className="space-y-4">
        {/* Account Name */}
        <h3 className="text-lg font-semibold text-gray-900">{accountName}</h3>

        {/* Account Number */}
        <p className="account-number text-sm text-gray-600">
          {formatAccountNumber(account.accountNumber)}
        </p>

        {/* Balance */}
        <div className="balance-display text-green-600">
          {formatCurrency(account.availableBalanceMinor)}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="gradient"
            size="sm"
            onClick={handleDetailsClick}
            className="!text-green-700 hover:!text-white"
          >
            Details
          </Button>
          <Button variant="outline" size="sm" onClick={handleTransferClick}>
            New transfer
          </Button>
          <Button variant="outline" size="sm" onClick={handleFundClick}>
            Fund Account
          </Button>
        </div>
      </div>
    </Card>
  );
}
