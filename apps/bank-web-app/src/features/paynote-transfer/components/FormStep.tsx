import { useEffect } from 'react';
import {
  TransferFormData,
  isValidBase64,
  decodePayNoteBase64AsObject,
} from '../../../lib/paynote';
import { ChevronLeft } from 'lucide-react';
import { PayNoteCodeInput } from './PayNoteCodeInput.tsx';
import { TransferPaymentForm } from './TransferPaymentForm.tsx';

interface Account {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
}

interface FormStepProps {
  formData: TransferFormData;
  accounts: Account[];
  onFormDataChange: (updates: Partial<TransferFormData>) => void;
  onNext: () => void;
  onCancel: () => void;
}

export function FormStep({
  formData,
  accounts,
  onFormDataChange,
  onNext,
  onCancel,
}: FormStepProps) {
  const isPayNoteEnabled = formData.isPayNoteEnabled ?? false;
  const payNoteCode = formData.payNoteCode ?? '';

  const handlePayNoteCodeChange = (code: string) => {
    onFormDataChange({ payNoteCode: code });
  };

  const handlePayNoteToggle = (enabled: boolean) => {
    if (!enabled) {
      onFormDataChange({
        isPayNoteEnabled: false,
        payNoteCode: undefined,
      });
      return;
    }

    onFormDataChange({
      isPayNoteEnabled: true,
    });
  };

  useEffect(() => {
    if (isPayNoteEnabled && payNoteCode && isValidBase64(payNoteCode)) {
      try {
        const payNote = decodePayNoteBase64AsObject(payNoteCode);
        if (payNote?.amount?.total?.value) {
          const amountFromPayNote = (payNote.amount.total.value / 100).toFixed(
            2
          );
          onFormDataChange({ totalAmount: amountFromPayNote });
        }
        if (payNote?.payerAccountNumber?.value) {
          const matchedAccount = accounts.find(
            account =>
              account.accountNumber === payNote?.payerAccountNumber?.value
          );
          if (matchedAccount) {
            onFormDataChange({ fromAccount: matchedAccount.accountNumber });
          }
        }
        if (payNote?.payeeAccountNumber?.value) {
          onFormDataChange({ toAccount: payNote?.payeeAccountNumber?.value });
        }
      } catch (error) {
        // Invalid PayNote, ignore
        console.error('Failed to parse PayNote:', error);
      }
    }
  }, [isPayNoteEnabled, payNoteCode, onFormDataChange]);

  const isFormValid = () => {
    if (isPayNoteEnabled) {
      return (
        Boolean(formData.fromAccount && formData.totalAmount) &&
        isPayNoteValid()
      );
    }

    return isStandardTransferValid();
  };

  const isPayNoteValid = () => {
    // If payNoteCode is empty, it's valid (not required)
    // If payNoteCode is not empty, check if it's valid base64
    return !isPayNoteEnabled || !payNoteCode || isValidBase64(payNoteCode);
  };

  const isStandardTransferValid = () => {
    if (!formData.fromAccount) {
      return false;
    }

    const selectedAccount = accounts.find(
      account => account.accountNumber === formData.fromAccount
    );

    if (!selectedAccount) {
      return false;
    }

    const amount = formData.totalAmount?.trim();
    if (!amount) {
      return false;
    }

    const amountRegex = /^\d+(\.\d{1,2})?$/;
    if (!amountRegex.test(amount)) {
      return false;
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return false;
    }

    if (
      Math.round(parsedAmount * 100) > selectedAccount.availableBalanceMinor
    ) {
      return false;
    }

    const destinationAccount = (formData.toAccount ?? '').trim();
    if (!destinationAccount) {
      return false;
    }

    const digitsOnly = /^\d{10}$/;
    if (!digitsOnly.test(destinationAccount)) {
      return false;
    }

    if (destinationAccount === selectedAccount.accountNumber) {
      return false;
    }

    return true;
  };

  const canProceed = () => isFormValid() && isPayNoteValid();

  const handleNext = () => {
    if (canProceed()) {
      onNext();
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-slate-200 px-8 py-4 flex flex-col items-center justify-center text-center relative">
        <button
          onClick={onCancel}
          className="absolute left-8 p-2 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-bold text-lg">Initiate New Transfer</span>
        <span className="mt-1 text-sm text-gray-600">
          Provide the payment details and continue to review.
        </span>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="grid md:grid-cols-2 gap-8 p-8 items-start flex-1">
          {/* Left Column - Transfer Form */}
          <div className="rounded-xl border border-slate-200 p-8 shadow-lg md:order-1">
            <TransferPaymentForm
              initialValues={formData}
              accounts={accounts}
              onValuesChange={onFormDataChange}
            />
          </div>

          {/* Right Column - PayNote Code Input */}
          <div className="h-fit rounded-xl border border-slate-200 p-8 shadow-lg md:order-2">
            <PayNoteCodeInput
              enabled={isPayNoteEnabled}
              value={payNoteCode}
              onToggle={handlePayNoteToggle}
              onChange={handlePayNoteCodeChange}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 px-8 py-3 flex justify-end space-x-3 mt-auto">
        <button
          onClick={onCancel}
          className="px-6 py-2 border border-green-500 text-green-500 rounded-full font-semibold hover:bg-green-50 transition-colors sm:px-20"
        >
          Cancel
        </button>
        <button
          onClick={handleNext}
          disabled={!canProceed()}
          className={`px-8 py-2 rounded-full font-semibold transition-all sm:px-24 ${
            canProceed()
              ? 'cursor-pointer bg-gradient-to-l from-green-500 to-yellow-400 text-white hover:opacity-90'
              : 'cursor-not-allowed bg-slate-300 text-gray-500'
          }`}
        >
          Next
        </button>
      </div>
    </div>
  );
}
