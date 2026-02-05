import type { Account } from '../../../types/api';
import { HorizontalAccountsList } from './HorizontalAccountsList';

interface AccountsSectionProps {
  accounts: Account[];
  onCreateAccount: () => void;
  onTransfer: (accountId: string) => void;
  onFund?: (accountId: string) => void;
  onEditCreditLimit?: (accountId: string) => void;
  isCreatingAccount?: boolean;
  showActions?: boolean;
  selectOnCardClick?: boolean;
  cardSize?: 'default' | 'compact';
}

export function AccountsSection({
  accounts,
  onCreateAccount,
  onTransfer,
  onFund,
  onEditCreditLimit,
  isCreatingAccount = false,
  showActions = true,
  selectOnCardClick = false,
  cardSize = 'default',
}: AccountsSectionProps) {
  return (
    <section className="app-surface rounded-none sm:rounded-[20px] shadow-none sm:shadow-[var(--shadow-soft)]">
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
        showActions={showActions}
        selectOnCardClick={selectOnCardClick}
        cardSize={cardSize}
      />
    </section>
  );
}
