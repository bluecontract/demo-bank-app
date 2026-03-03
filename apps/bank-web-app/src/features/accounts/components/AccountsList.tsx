import { AccountCard } from './AccountCard';
import { AddAccountCard } from './AddAccountCard';
import { Account } from '../../../types/api';

interface AccountsListProps {
  accounts: Account[];
  onCreateAccount: () => void;
  onAccountDetails: (accountId: string) => void;
  onTransfer: (accountId: string) => void;
  onFund?: (accountId: string) => void;
  onEditCreditLimit?: (accountId: string) => void;
  isCreatingAccount?: boolean;
  'data-testid'?: string;
}

export function AccountsList({
  accounts,
  onCreateAccount,
  onAccountDetails,
  onTransfer,
  onFund,
  onEditCreditLimit,
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
        <AccountCard
          key={account.accountId}
          account={account}
          onSelect={onAccountDetails}
          onTransferClick={onTransfer}
          onFundClick={onFund}
          onEditCreditLimitClick={onEditCreditLimit}
        />
      ))}

      {/* Add account card */}
      <AddAccountCard onClick={onCreateAccount} isLoading={isCreatingAccount} />
    </div>
  );
}
