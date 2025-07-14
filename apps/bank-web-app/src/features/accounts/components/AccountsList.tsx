import { AccountCard } from './AccountCard';
import { AddAccountCard } from './AddAccountCard';

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

interface AccountsListProps {
  accounts: Account[];
  onCreateAccount: () => void;
  isCreatingAccount?: boolean;
  'data-testid'?: string;
}

export function AccountsList({
  accounts,
  onCreateAccount,
  isCreatingAccount = false,
  'data-testid': testId,
}: AccountsListProps) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6"
      data-testid={testId}
    >
      {/* Render account cards */}
      {accounts.map(account => (
        <AccountCard key={account.accountId} account={account} />
      ))}

      {/* Add account card */}
      <AddAccountCard onClick={onCreateAccount} isLoading={isCreatingAccount} />
    </div>
  );
}
