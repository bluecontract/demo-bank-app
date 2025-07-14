import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { DashboardHeader } from '../../features/dashboard/components';
import {
  AccountsList,
  AddAccountCard,
} from '../../features/accounts/components';
import { TransferModal, FundModal } from '../../features/transfer';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCreateAccount } from '../../features/accounts/hooks/useCreateAccount';

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

  const handleAccountDetails = (accountId: string) => {
    // TODO: Navigate to account details page
    console.log('Navigate to account details:', accountId);
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
        <div className="text-white text-xl">Loading your accounts...</div>
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
    <div
      className="min-h-screen bg-gradient-to-br from-green-400 to-yellow-400"
      data-testid="dashboard-main-container"
    >
      <div className="container mx-auto px-4 py-8">
        <DashboardHeader userName={user?.name || 'Guest'} />

        <div className="mt-8">
          {accounts && accounts.length > 0 ? (
            <AccountsList
              accounts={accounts}
              onCreateAccount={handleCreateAccount}
              onAccountDetails={handleAccountDetails}
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
    </div>
  );
}
