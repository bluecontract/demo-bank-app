import { useAuth } from '../../app/providers/AuthProvider';
import { DashboardHeader } from '../../features/dashboard/components';
import {
  AccountsList,
  AddAccountCard,
} from '../../features/accounts/components';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCreateAccount } from '../../features/accounts/hooks/useCreateAccount';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();
  const { mutate: createAccount, isPending: isCreating } = useCreateAccount();

  const handleCreateAccount = () => {
    createAccount({ currency: 'USD' });
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
    </div>
  );
}
