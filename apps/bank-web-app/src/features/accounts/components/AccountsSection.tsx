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
      <div className="flex items-center justify-between px-6 pt-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
            Accounts
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">
            Your portfolios
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="app-chip app-chip-neutral">
            {accounts.length} active
          </span>
          <span className="app-chip">USD</span>
        </div>
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
