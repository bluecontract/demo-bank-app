import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import {
  DashboardHeader,
  SidebarNav,
} from '../../features/dashboard/components';
import {
  AccountCreationModal,
  AccountsSection,
} from '../../features/accounts/components';
import { FundModal } from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import {
  CardsPanel,
  CardSimulatorPanel,
} from '../../features/cards/components';
import { SpinnerWithText } from '../../ui/Spinner';
import type { Account } from '../../types/api';

export function CardsPage() {
  const { user } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();
  const navigate = useNavigate();

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

  const handleCreateAccount = () => {
    setAccountCreationModal({ isOpen: true });
  };

  const closeAccountCreationModal = () => {
    setAccountCreationModal({ isOpen: false });
  };

  const handleTransfer = (accountId: string) => {
    navigate(`/transfer/new?accountId=${accountId}`);
  };

  const handleFund = (accountId: string) => {
    const account = accounts?.find(acc => acc.accountId === accountId);
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
            <DashboardHeader
              userEmail={user?.email || 'Guest'}
              title="Cards"
              description="Issue cards, review status, and simulate transactions."
            />
          </div>

          <main className="flex-1 px-6 pb-8 lg:px-10 flex flex-col gap-6 min-h-0">
            <AccountsSection
              accounts={accounts || []}
              onCreateAccount={handleCreateAccount}
              onTransfer={handleTransfer}
              onFund={handleFund}
            />

            <section className="grid gap-6 lg:grid-cols-2">
              <CardsPanel />
              <CardSimulatorPanel />
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
        accounts={accounts || []}
        defaultAccountId={fundModal.sourceAccount?.accountId}
      />
    </SelectedAccountProvider>
  );
}
