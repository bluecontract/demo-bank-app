import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import { SidebarNav } from '../../features/dashboard/components';
import {
  AccountCreationModal,
  AccountsSection,
  CreditLimitModal,
} from '../../features/accounts/components';
import { FundModal } from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { CardsPanel } from '../../features/cards/components';
import { SpinnerWithText } from '../../ui/Spinner';
import type { Account, CardSummary } from '../../types/api';

export function CardsPage() {
  const { user, signOut } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();
  const navigate = useNavigate();
  const [selectedCard, setSelectedCard] = useState<CardSummary | null>(null);

  const [accountCreationModal, setAccountCreationModal] = useState({
    isOpen: false,
  });

  const [fundModal, setFundModal] = useState<{
    isOpen: boolean;
    sourceAccount: Account | null;
  }>({
    isOpen: false,
    sourceAccount: null,
  });
  const [creditLimitModal, setCreditLimitModal] = useState<{
    isOpen: boolean;
    sourceAccount: Account | null;
  }>({
    isOpen: false,
    sourceAccount: null,
  });

  const depositAccounts =
    accounts?.filter(account => account.accountType !== 'CREDIT_LINE') ?? [];
  const creditLineAccounts =
    accounts?.filter(account => account.accountType === 'CREDIT_LINE') ?? [];

  const handleCreateAccount = () => {
    setAccountCreationModal({ isOpen: true });
  };

  const handleSignOut = () => {
    signOut();
  };

  const closeAccountCreationModal = () => {
    setAccountCreationModal({ isOpen: false });
  };

  const handleTransfer = (accountId: string) => {
    navigate(`/transfer/new?accountId=${accountId}`);
  };

  const handleFund = (accountId: string) => {
    const account = depositAccounts.find(acc => acc.accountId === accountId);
    if (account) {
      setFundModal({
        isOpen: true,
        sourceAccount: account,
      });
    }
  };

  const closeFundModal = () => {
    setFundModal({
      isOpen: false,
      sourceAccount: null,
    });
  };

  const handleEditCreditLimit = (accountId: string) => {
    const account = creditLineAccounts.find(acc => acc.accountId === accountId);
    if (account) {
      setCreditLimitModal({
        isOpen: true,
        sourceAccount: account,
      });
    }
  };

  const closeCreditLimitModal = () => {
    setCreditLimitModal({
      isOpen: false,
      sourceAccount: null,
    });
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
      <div className="app-shell flex" data-testid="cards-main-container">
        <SidebarNav />

        <div className="flex-1 flex flex-col min-h-screen">
          <div className="px-6 pt-8 pb-4 lg:px-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-3xl font-semibold text-slate-900">Cards</h1>
              <div className="flex items-center gap-3">
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
          </div>

          <main className="flex-1 px-6 pb-8 lg:px-10 flex flex-col gap-6 min-h-0">
            <AccountsSection
              accounts={accounts || []}
              onCreateAccount={handleCreateAccount}
              onTransfer={handleTransfer}
              onFund={handleFund}
              onEditCreditLimit={handleEditCreditLimit}
              showActions={false}
              selectOnCardClick={true}
              cardSize="compact"
            />

            <section className="flex flex-col min-h-0">
              <CardsPanel
                selectedCardId={selectedCard?.cardId ?? null}
                onSelectCard={setSelectedCard}
              />
            </section>
          </main>
        </div>
      </div>

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
