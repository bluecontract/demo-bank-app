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
  onDetailsClick?: (accountId: string) => void;
  onTransferClick?: (accountId: string) => void;
  onFundClick?: (accountId: string) => void;
}

export function AccountCard({
  account,
  accountName = 'Checking Account',
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

  return (
    <Card className="p-6">
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
          <Button variant="primary" size="sm" onClick={handleDetailsClick}>
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
