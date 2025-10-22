import { useMemo, useState } from 'react';
import {
  decodePayNoteBase64AsObject,
  TransferFormData,
} from '../../../lib/paynote';
import { ChevronLeft, CornerDownLeft, Loader2 } from 'lucide-react';
import { useTransferMoney } from '../../transfer/hooks/useTransferMoney.ts';
import { useApiClient } from '../../../app/providers/ApiProvider';

interface Account {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
}

interface AuthorizationStepProps {
  formData: TransferFormData;
  accounts: Account[];
  onAuthorize: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function AuthorizationStep({
  formData,
  accounts,
  onAuthorize,
  onBack,
  onCancel,
}: AuthorizationStepProps) {
  const apiClient = useApiClient();
  const isPayNoteEnabled = formData.isPayNoteEnabled ?? false;
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transferMoney = useTransferMoney({
    onSuccess: () => {
      setError(null);
      onAuthorize();
    },
    onError: error => {
      const errorBody = (error as { body?: { error?: string } })?.body;
      if (errorBody?.error === 'ACCOUNT_NOT_FOUND') {
        setError(
          'Account not found. External outgoing transfers are not yet supported.'
        );
      } else {
        setError(error.message);
      }
    },
  });

  const selectedAccount = useMemo(
    () => accounts.find(acc => acc.accountId === formData.fromAccount),
    [accounts, formData.fromAccount]
  );

  const getAccountDisplayName = (accountId?: string) => {
    if (!accountId) return 'Unknown account';
    const account = accounts.find(acc => acc.accountId === accountId);
    return account ? `${account.name} - ${account.accountNumber}` : accountId;
  };

  const handleAuthorize = async () => {
    setError(null);

    if (!isPayNoteEnabled) {
      if (!formData.fromAccount || !selectedAccount) {
        setError('Source account is required.');
        return;
      }

      const amountString = formData.totalAmount?.trim() ?? '';
      const amountRegex = /^\d+(\.\d{1,2})?$/;

      if (!amountRegex.test(amountString)) {
        setError('Enter a valid amount with up to 2 decimal places.');
        return;
      }

      const amount = parseFloat(amountString);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Amount must be greater than zero.');
        return;
      }

      const amountMinor = Math.round(amount * 100);
      if (amountMinor > selectedAccount.availableBalanceMinor) {
        setError('Amount exceeds available balance.');
        return;
      }

      const destinationAccount = formData.toAccount?.trim() ?? '';
      if (!/^\d{10}$/.test(destinationAccount)) {
        setError('Destination account number must be exactly 10 digits.');
        return;
      }

      if (destinationAccount === selectedAccount.accountNumber) {
        setError('Cannot transfer to the same account.');
        return;
      }

      transferMoney.mutate({
        sourceAccountId: selectedAccount.accountId,
        destinationAccountNumber: destinationAccount,
        amountMinor,
        description: formData.title?.trim() || undefined,
      });
      return;
    }

    setIsProcessing(true);

    try {
      if (!formData.payNoteCode) {
        throw new Error('PayNote is missing or invalid.');
      }

      const payNote = decodePayNoteBase64AsObject(formData.payNoteCode);

      if (!payNote) {
        throw new Error('PayNote is missing or invalid.');
      }

      const response = await apiClient.banking.bootstrapPayNote({
        body: { payNote, formData },
      });

      if (response.status !== 200) {
        throw new Error('Bootstrap request failed.');
      }

      onAuthorize();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Unable to bootstrap PayNote. Please try again later.';

      setError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const isSubmitting = isPayNoteEnabled
    ? isProcessing
    : transferMoney.isPending;

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-slate-200 px-8 py-4 flex flex-col items-center justify-center relative">
        <button
          onClick={onBack}
          className="absolute left-8 p-2 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
          disabled={isSubmitting}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-bold">
          {isPayNoteEnabled
            ? 'Authorize New Transfer with PayNote'
            : 'Authorize Transfer'}
        </span>
        <span className="text-sm mt-1">
          From {getAccountDisplayName(formData.fromAccount)}
        </span>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="grid md:grid-cols-2 gap-8 p-8 items-start flex-1">
          {/* Left Column - Transfer Details */}
          <div className="rounded-xl shadow-lg p-8 border border-slate-200">
            <div className="space-y-4">
              <div className="relative">
                <CornerDownLeft className="absolute left-2 top-1/2 transform -translate-y-1/2 h-6 w-6 text-red-500" />
                <span className="absolute left-12 top-1/2 transform -translate-y-1/2 text-3xl font-bold text-gray-900">
                  $
                </span>
                <div className="w-full p-4 pl-20 text-3xl font-bold text-gray-900">
                  {formData.totalAmount
                    ? new Intl.NumberFormat('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(Number(formData.totalAmount))
                    : '0.00'}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-lg">
                  <span>To:</span>{' '}
                  {formData.recipientName ?? 'Unknown recipient'}
                </div>
                <div className="text-lg">
                  <span>Title:</span> {formData.title ?? 'No title'}
                </div>
              </div>

              <hr className="border-slate-200" />

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">From account:</span>
                  <span className="font-medium">
                    {getAccountDisplayName(formData.fromAccount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">To account:</span>
                  <span className="font-medium">
                    {formData.toAccount ?? 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Date:</span>
                  <span className="font-medium">
                    {formData.date ?? 'Not provided'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Authorization Message */}
          <div className="rounded-xl shadow-lg p-8 border border-slate-200 h-fit">
            <div className="space-y-4">
              <p className="leading-relaxed">
                {isPayNoteEnabled
                  ? 'By approving, you instruct Your Bank to initiate this smart agreement. We will then act as a trusted Guarantor, automatically executing payments only when the conditions defined in the PayNote are verifiably met.'
                  : 'By approving, you authorise Your Bank to execute the transfer immediately using the standard banking workflow.'}
              </p>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 px-8 py-3 flex justify-end space-x-3 mt-auto">
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-6 sm:px-20 py-2 border border-green-500 text-green-500 rounded-full hover:bg-green-50 transition-colors font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={handleAuthorize}
          disabled={isSubmitting}
          className={`flex items-center justify-center gap-2 rounded-full px-8 sm:px-24 py-2 font-semibold transition-all ${
            isSubmitting
              ? 'cursor-not-allowed bg-slate-300 text-slate-500'
              : 'cursor-pointer bg-gradient-to-l from-green-500 to-yellow-400 text-white hover:opacity-90'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Authorize'
          )}
        </button>
      </div>
    </div>
  );
}
