import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import {
  DashboardHeader,
  DashboardShell,
} from '../../features/dashboard/components';
import {
  AccountCreationModal,
  AccountsSection,
  CreditLimitModal,
} from '../../features/accounts/components';
import { useAccountModals } from '../../features/accounts/hooks/useAccountModals';
import { FundModal } from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { CardsPanel } from '../../features/cards/components';
import { SpinnerWithText } from '../../ui/Spinner';
import type { CardSummary } from '../../types/api';

export function CardsPage() {
  const { user } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();
  const navigate = useNavigate();
  const [selectedCard, setSelectedCard] = useState<CardSummary | null>(null);

  const {
    depositAccounts,
    creditLineAccounts,
    accountCreationModal,
    fundModal,
    creditLimitModal,
    openAccountCreationModal,
    closeAccountCreationModal,
    openFundModal,
    closeFundModal,
    openCreditLimitModal,
    closeCreditLimitModal,
  } = useAccountModals(accounts);

  const handleTransfer = (accountId: string) => {
    navigate(`/transfer/new?accountId=${accountId}`);
  };

  if (isLoading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <SpinnerWithText
          text="Loading your accounts..."
          size="xl"
          color="green"
          textClassName="text-slate-700 text-lg"
          data-testid="accounts-loading-spinner"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell flex items-center justify-center">
        <div className="app-surface px-8 py-6 text-slate-700 text-lg">
          Error loading accounts. Please try again.
        </div>
      </div>
    );
  }

  return (
    <SelectedAccountProvider>
      <DashboardShell
        data-testid="cards-main-container"
        contentWidth="full"
        header={
          <DashboardHeader userEmail={user?.email || 'Guest'} title="Cards" />
        }
      >
        <AccountsSection
          accounts={accounts || []}
          onCreateAccount={openAccountCreationModal}
          onTransfer={handleTransfer}
          onFund={openFundModal}
          onEditCreditLimit={openCreditLimitModal}
          showActions={false}
          showAddAccountCard={false}
          cardSize="compact"
        />

        <section className="flex flex-col min-h-0">
          <CardsPanel
            selectedCardId={selectedCard?.cardId ?? null}
            onSelectCard={setSelectedCard}
          />
        </section>
      </DashboardShell>

      <AccountCreationModal
        isOpen={accountCreationModal.isOpen}
        onClose={closeAccountCreationModal}
      />

      <FundModal
        isOpen={fundModal.isOpen}
        onClose={closeFundModal}
        accounts={depositAccounts}
        defaultAccountId={fundModal.sourceAccount?.accountId}
      />

      <CreditLimitModal
        isOpen={creditLimitModal.isOpen}
        onClose={closeCreditLimitModal}
        accounts={creditLineAccounts}
        defaultAccountId={creditLimitModal.sourceAccount?.accountId}
      />
    </SelectedAccountProvider>
  );
}
