import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { PayNoteTransferStepper } from '../../features/paynote-transfer/components';
import { SpinnerWithText } from '../../ui/Spinner';
import { useSearchParams } from 'react-router-dom';

export function NewTransferPage() {
  const { data: accounts, isLoading, error } = useAccounts();
  const [searchParams] = useSearchParams();
  const defaultAccountId = searchParams.get('accountId') || undefined;

  if (isLoading) {
    return (
      <div className="h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
        <SpinnerWithText text="Loading..." size="xl" color="white" />
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

  if (!accounts || accounts.length === 0) {
    return (
      <div className="h-screen bg-gradient-to-br from-green-400 to-yellow-400 flex items-center justify-center">
        <div className="text-white text-center">
          <h2 className="text-2xl font-bold mb-4">No Accounts Found</h2>
          <p className="mb-6">
            You need at least one account to make a transfer.
          </p>
          <a
            href="/dashboard"
            className="px-6 py-3 bg-white text-green-600 rounded-full font-semibold hover:bg-gray-100 transition-colors inline-block"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <PayNoteTransferStepper
      accounts={accounts}
      defaultAccountId={defaultAccountId}
    />
  );
}
