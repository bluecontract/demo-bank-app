import { Card } from '../../../ui/Card';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';

export function TransactionHistory() {
  const { selectedAccount } = useSelectedAccount();

  return (
    <Card className="p-8 flex-1 flex flex-col">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Transaction History
        </h2>
        {selectedAccount && (
          <p className="text-sm text-gray-600">
            Account: {selectedAccount.accountNumber}
          </p>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-6xl mb-4">📋</div>
          <div className="text-xl mb-2">No transactions yet</div>
          <p className="text-sm">
            Your transaction history will appear here once you make your first
            transfer
          </p>
        </div>
      </div>
    </Card>
  );
}
