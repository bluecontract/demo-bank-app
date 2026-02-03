import type { Account } from '../../../types/api';
import { HorizontalAccountsList } from './HorizontalAccountsList';

interface AccountsSectionProps {
  accounts: Account[];
  onCreateAccount: () => void;
  onTransfer: (accountId: string) => void;
  onFund?: (accountId: string) => void;
  onEditCreditLimit?: (accountId: string) => void;
  isCreatingAccount?: boolean;
}

export function AccountsSection({
  accounts,
  onCreateAccount,
  onTransfer,
  onFund,
  onEditCreditLimit,
  isCreatingAccount = false,
}: AccountsSectionProps) {
  return (
    <section className="app-surface">
      <div className="px-4 pt-4">
        <h2 className="text-base font-semibold text-slate-900">Accounts</h2>
      </div>
      <HorizontalAccountsList
        accounts={accounts}
        onCreateAccount={onCreateAccount}
        onTransfer={onTransfer}
        onFund={onFund}
        onEditCreditLimit={onEditCreditLimit}
        isCreatingAccount={isCreatingAccount}
      />
    </section>
  );
}
