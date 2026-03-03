import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import { DashboardShell } from '../../features/dashboard/components';
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
  const { user, signOut } = useAuth();
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

  const handleSignOut = () => {
    signOut();
  };

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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-semibold text-slate-900">Cards</h1>
            <div className="hidden lg:flex items-center gap-3">
              <span className="text-sm text-slate-600">
                {user?.email || 'Guest'}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-slate-200 bg-white/80 p-2 text-slate-600 transition hover:text-slate-900"
                aria-label="Sign out"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v6m6.364-2.364A9 9 0 105.636 6.636"
                  />
                </svg>
              </button>
            </div>
          </div>
        }
      >
        <AccountsSection
          accounts={accounts || []}
          onCreateAccount={openAccountCreationModal}
          onTransfer={handleTransfer}
          onFund={openFundModal}
          onEditCreditLimit={openCreditLimitModal}
          showActions={false}
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
