import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { SelectedAccountProvider } from '../../app/providers/SelectedAccountProvider';
import { DashboardShell } from '../../features/dashboard/components';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { SpinnerWithText } from '../../ui/Spinner';
import { TransactionDetailsPanel } from '../../features/transactions/components/TransactionDetailsPanel';
import type { ActivityItem } from '../../features/transactions/hooks/useActivity';
import { fromRouteActivityId } from '../../features/transactions/lib/activityRoutes';
import { Button } from '../../ui/Button';

interface TransactionDetailsPageContentProps {
  userEmail: string;
  onSignOut: () => void;
  accounts: NonNullable<ReturnType<typeof useAccounts>['data']>;
}

type LocationState = {
  from?: string;
  selectedActivity?: ActivityItem;
};

function TransactionDetailsPageContent({
  userEmail,
  onSignOut,
  accounts,
}: TransactionDetailsPageContentProps) {
  const { accountId, activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) ?? null;
  const backTarget = locationState?.from || '/transactions';

  const resolvedAccount = useMemo(
    () => accounts.find(account => account.accountId === accountId),
    [accounts, accountId]
  );

  const handleBack = () => {
    navigate(backTarget);
  };

  const resolvedActivityId = activityId ? fromRouteActivityId(activityId) : '';

  return (
    <DashboardShell
      data-testid="transaction-details-page"
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back to transactions"
              className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 transition hover:text-slate-900"
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h1 className="text-3xl font-semibold text-slate-900">
              Transaction details
            </h1>
          </div>
          <div className="hidden lg:flex items-center gap-3">
            <span className="text-sm text-slate-600">{userEmail}</span>
            <button
              type="button"
              onClick={onSignOut}
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
      {!accountId || !activityId ? (
        <div className="app-surface p-4 text-center text-slate-600">
          <p className="text-sm">Missing transaction details.</p>
          <Button className="mt-4" onClick={handleBack}>
            Back to transactions
          </Button>
        </div>
      ) : (
        <TransactionDetailsPanel
          accountId={accountId}
          accountNumber={resolvedAccount?.accountNumber}
          activityId={resolvedActivityId}
          selectedActivity={locationState?.selectedActivity}
          currentAccountNumber={resolvedAccount?.accountNumber}
          accounts={accounts}
          userEmail={userEmail}
          onClose={handleBack}
          closeLabel="Back to transactions"
        />
      )}
    </DashboardShell>
  );
}

export function TransactionDetailsPage() {
  const { user, signOut } = useAuth();
  const { data: accounts, isLoading, error } = useAccounts();

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
        <div className="app-surface p-4 text-lg text-slate-700">
          Error loading accounts. Please try again.
        </div>
      </div>
    );
  }

  return (
    <SelectedAccountProvider>
      <TransactionDetailsPageContent
        userEmail={user?.email || 'Guest'}
        onSignOut={signOut}
        accounts={accounts || []}
      />
    </SelectedAccountProvider>
  );
}
