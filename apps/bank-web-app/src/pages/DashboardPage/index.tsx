import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import { DashboardHeader } from '../../features/dashboard/components';
import {
  HorizontalAccountsList,
  AccountCreationModal,
} from '../../features/accounts/components';
import { FundModal, TransactionHistory } from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { SpinnerWithText } from '../../ui/Spinner';

type Account = {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

export function DashboardPage() {
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
      <div className="h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
        <SpinnerWithText
          text="Loading your accounts..."
          size="xl"
          color="white"
          data-testid="accounts-loading-spinner"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
        <div className="text-white text-xl">
          Error loading accounts. Please try again.
        </div>
      </div>
    );
  }

  return (
    <SelectedAccountProvider>
      <div
        className="h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex flex-col overflow-hidden"
        data-testid="dashboard-main-container"
      >
        <div className="px-4 py-4">
          <DashboardHeader userEmail={user?.email || 'Guest'} />

          <div className="mt-4">
            {/* Accounts Section */}
            <HorizontalAccountsList
              accounts={accounts || []}
              onCreateAccount={handleCreateAccount}
              onTransfer={handleTransfer}
              onFund={handleFund}
              isCreatingAccount={false}
            />
          </div>
        </div>

        {/* Transaction History Section - Full Width and Fill Height */}
        <div className="flex-1 px-4 pb-4 pt-2 flex flex-col min-h-0">
          <TransactionHistory />
        </div>
      </div>

      {/* Account Creation Modal */}
      <AccountCreationModal
        isOpen={accountCreationModal.isOpen}
        onClose={closeAccountCreationModal}
      />

      {/* Fund Modal */}
      <FundModal
        isOpen={fundModal.isOpen}
        onClose={closeFundModal}
        accounts={accounts || []}
        defaultAccountId={fundModal.sourceAccount?.accountId}
      />
    </SelectedAccountProvider>
  );
}
