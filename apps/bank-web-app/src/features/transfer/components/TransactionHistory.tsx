import { Card } from '../../../ui/Card';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useActivity } from '../../transactions/hooks/useActivity';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { TransactionList } from '../../transactions/components/TransactionList';

export function TransactionHistory() {
  const { selectedAccount } = useSelectedAccount();
  const { data: accounts } = useAccounts();

  const {
    data: activityData,
    isLoading,
    isError,
  } = useActivity({
    accountNumber: selectedAccount?.accountNumber || null,
  });

  const activityItems = activityData?.items || [];
  const isEmpty = !isLoading && !isError && activityItems.length === 0;

  return (
    <Card className="p-8 flex flex-col flex-1 min-h-0">
      <div className="mb-6 flex-shrink-0 flex items-center gap-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Transaction History
        </h2>
        {selectedAccount && (
          <div className="text-base text-gray-700 bg-green-100 px-4 py-2 rounded-lg">
            Account:{' '}
            <span className="font-medium">{selectedAccount.accountNumber}</span>
          </div>
        )}
      </div>

      <TransactionList
        activityItems={activityItems}
        accountId={selectedAccount?.accountId || ''}
        currentAccountNumber={selectedAccount?.accountNumber}
        accounts={accounts}
        isLoading={isLoading}
        isError={isError}
        isEmpty={isEmpty}
        data-testid="transaction-history-list"
      />
    </Card>
  );
}
