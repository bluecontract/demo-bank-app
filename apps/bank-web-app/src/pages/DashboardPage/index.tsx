import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import { DashboardHeader } from '../../features/dashboard/components';
import {
  HorizontalAccountsList,
  AddAccountCard,
} from '../../features/accounts/components';
import {
  TransferModal,
  FundModal,
  TransactionHistory,
} from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCreateAccount } from '../../features/accounts/hooks/useCreateAccount';
import { SpinnerWithText } from '../../ui/Spinner';

type Account = {
  accountId: string;
  accountNumber: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

export function DashboardPage() {
  const { user } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();
  const { mutate: createAccount, isPending: isCreating } = useCreateAccount();

  const [transferModal, setTransferModal] = useState<{
    isOpen: boolean;
    defaultAccountId: string | undefined;
  }>({
    isOpen: false,
    defaultAccountId: undefined,
  });

  const [fundModal, setFundModal] = useState<{
    isOpen: boolean;
    sourceAccount: Account | null;
  }>({
    isOpen: false,
    sourceAccount: null,
  });

  const handleCreateAccount = () => {
    createAccount({ currency: 'USD' });
  };

  const handleTransfer = (accountId: string) => {
    setTransferModal({
      isOpen: true,
      defaultAccountId: accountId,
    });
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

  const closeTransferModal = () => {
    setTransferModal({
      isOpen: false,
      defaultAccountId: undefined,
    });
  };

  const closeFundModal = () => {
    setFundModal({
      isOpen: false,
      sourceAccount: null,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
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
      <div className="min-h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
        <div className="text-white text-xl">
          Error loading accounts. Please try again.
        </div>
      </div>
    );
  }

  return (
    <SelectedAccountProvider>
      <div
        className="min-h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex flex-col"
        data-testid="dashboard-main-container"
      >
        <div className="px-4 py-4">
          <DashboardHeader userName={user?.name || 'Guest'} />

          <div className="mt-4">
            {/* Accounts Section */}
            {accounts && accounts.length > 0 ? (
              <HorizontalAccountsList
                accounts={accounts}
                onCreateAccount={handleCreateAccount}
                onTransfer={handleTransfer}
                onFund={handleFund}
                isCreatingAccount={isCreating}
              />
            ) : (
              <div className="text-center">
                <div className="text-white mb-8">
                  <p className="text-lg">
                    No accounts yet. Create your first account to get started!
                  </p>
                </div>
                <div className="flex justify-center">
                  <AddAccountCard
                    onClick={handleCreateAccount}
                    isLoading={isCreating}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Transaction History Section - Full Width and Fill Height */}
        {accounts && accounts.length > 0 && (
          <div className="flex-1 px-4 pb-4 pt-2 flex flex-col">
            <TransactionHistory />
          </div>
        )}
      </div>

      {/* Transfer Modal */}
      {accounts && accounts.length > 0 && (
        <TransferModal
          isOpen={transferModal.isOpen}
          onClose={closeTransferModal}
          accounts={accounts}
          defaultAccountId={transferModal.defaultAccountId}
        />
      )}

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
