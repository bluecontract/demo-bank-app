import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  SelectedAccountProvider,
  useSelectedAccount,
} from '../../app/providers/SelectedAccountProvider';
import { DashboardShell } from '../../features/dashboard/components';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCards } from '../../features/cards/hooks/useCards';
import { TransactionHistory } from '../../features/transfer';
import { SpinnerWithText } from '../../ui/Spinner';
import { Select } from '../../ui/Select';

interface TransactionsPageContentProps {
  userEmail: string;
  onSignOut: () => void;
  accounts: NonNullable<ReturnType<typeof useAccounts>['data']>;
}

function TransactionsPageContent({
  userEmail,
  onSignOut,
  accounts,
}: TransactionsPageContentProps) {
  const { selectedAccount, setSelectedAccount } = useSelectedAccount();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, selectedAccount, setSelectedAccount]);

  useEffect(() => {
    setSelectedCardId(null);
  }, [selectedAccount?.accountId]);

  const accountSelectValue = selectedAccount?.accountId ?? '';

  const handleAccountChange = (accountId: string) => {
    const nextAccount =
      accounts.find(account => account.accountId === accountId) ?? null;
    setSelectedAccount(nextAccount);
  };

  const cardsQuery = useCards({
    accountId: selectedAccount?.accountId ?? null,
  });

  const cardOptions = useMemo(() => {
    if (!cardsQuery.data) {
      return [];
    }
    return cardsQuery.data.map(card => ({
      value: card.cardId,
      label: `**** ${card.panLast4}`,
    }));
  }, [cardsQuery.data]);

  const isCardSelectDisabled =
    !selectedAccount || cardsQuery.isLoading || cardsQuery.isError;

  const accountOptions = useMemo(
    () =>
      accounts.map(account => ({
        value: account.accountId,
        label: account.name,
      })),
    [accounts]
  );

  const cardSelectValue = selectedCardId ?? '';
  const cardSelectOptions = useMemo(
    () => [
      { value: '', label: 'All cards' },
      ...cardOptions.map(option => ({
        value: option.value,
        label: option.label,
      })),
    ],
    [cardOptions]
  );

  return (
    <DashboardShell
      data-testid="transactions-main-container"
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">
            Transactions
          </h1>
          <div className="flex items-center gap-3">
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
      <div className="app-surface p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            value={accountSelectValue}
            onChange={handleAccountChange}
            options={accountOptions}
            aria-label="Select account"
            disabled={accounts.length === 0}
          />

          <Select
            value={cardSelectValue}
            onChange={nextValue =>
              setSelectedCardId(nextValue ? nextValue : null)
            }
            options={cardSelectOptions}
            aria-label="Select card"
            disabled={isCardSelectDisabled}
          />
        </div>
      </div>

      <section className="flex-1 min-h-0">
        {selectedAccount ? (
          <TransactionHistory cardId={selectedCardId} />
        ) : (
          <div className="app-surface flex items-center justify-center h-full p-6 text-sm text-slate-500">
            Select an account to view transaction history.
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

export function TransactionsPage() {
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
        <div className="app-surface px-8 py-6 text-slate-700 text-lg">
          Error loading accounts. Please try again.
        </div>
      </div>
    );
  }

  return (
    <SelectedAccountProvider>
      <TransactionsPageContent
        userEmail={user?.email || 'Guest'}
        onSignOut={signOut}
        accounts={accounts || []}
      />
    </SelectedAccountProvider>
  );
}
