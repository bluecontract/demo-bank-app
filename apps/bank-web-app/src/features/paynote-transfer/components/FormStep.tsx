import { useEffect, useMemo, useState } from 'react';
import {
  TransferFormData,
  isValidBase64,
  decodePayNoteBase64AsObject,
  examplePayNotes,
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

type AmountStatus =
  | 'valid'
  | 'missing'
  | 'invalid-format'
  | 'non-positive'
  | 'insufficient-funds';
type DestinationAccountStatus = 'valid' | 'missing' | 'invalid' | 'own-account';
type ModalState =
  | { type: 'amount'; reason: AmountStatus }
  | {
      type: 'destination';
      context: 'standard' | 'paynote';
      reason: DestinationAccountStatus;
    }
  | null;

export function FormStep({
  formData,
  accounts,
  onFormDataChange,
  onNext,
  onCancel,
}: FormStepProps) {
  const isPayNoteEnabled = formData.isPayNoteEnabled ?? false;
  const payNoteCode = formData.payNoteCode ?? '';

  const [activeModal, setActiveModal] = useState<ModalState>(null);

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
        if (payNote?.amount?.total) {
          const amountFromPayNote = (payNote.amount.total / 100).toFixed(2);
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

  const selectedAccount = useMemo(() => {
    return accounts.find(
      account => account.accountNumber === formData.fromAccount
    );
  }, [accounts, formData.fromAccount]);

  const isPayNoteValid = () => {
    // If payNoteCode is empty, it's valid (not required)
    // If payNoteCode is not empty, check if it's valid base64
    return !isPayNoteEnabled || !payNoteCode || isValidBase64(payNoteCode);
  };

  const getAmountStatus = (): AmountStatus => {
    if (!formData.fromAccount || !selectedAccount) {
      return 'invalid-format';
    }

    const amount = formData.totalAmount?.trim();
    if (!amount) {
      return 'missing';
    }

    const amountRegex = /^\d+(\.\d{1,2})?$/;
    if (!amountRegex.test(amount)) {
      return 'invalid-format';
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return 'non-positive';
    }

    if (
      Math.round(parsedAmount * 100) > selectedAccount.availableBalanceMinor
    ) {
      return 'insufficient-funds';
    }

    return 'valid';
  };

  const getDestinationAccountStatus = (): DestinationAccountStatus => {
    if (!selectedAccount) {
      return 'invalid';
    }

    const destinationAccount = (formData.toAccount ?? '').trim();
    if (!destinationAccount) {
      return 'missing';
    }

    const digitsOnly = /^\d{10}$/;
    if (!digitsOnly.test(destinationAccount)) {
      return 'invalid';
    }

    if (destinationAccount === selectedAccount.accountNumber) {
      return 'own-account';
    }

    return 'valid';
  };

  const isFormValid = () => {
    if (!formData.fromAccount || !selectedAccount) {
      return false;
    }

    const amountStatus = getAmountStatus();
    if (amountStatus === 'invalid-format' || amountStatus === 'non-positive') {
      return false;
    }

    if (isPayNoteEnabled) {
      return isPayNoteValid();
    }

    return true;
  };

  const canProceed = () => isFormValid();

  const handleNext = () => {
    if (!canProceed()) {
      return;
    }

    const amountStatus = getAmountStatus();
    if (amountStatus === 'missing') {
      setActiveModal({ type: 'amount', reason: amountStatus });
      return;
    }

    if (amountStatus === 'insufficient-funds') {
      setActiveModal({ type: 'amount', reason: amountStatus });
      return;
    }

    const destinationStatus = getDestinationAccountStatus();
    if (destinationStatus !== 'valid') {
      const context = isPayNoteEnabled ? 'paynote' : 'standard';
      setActiveModal({
        type: 'destination',
        context,
        reason: destinationStatus,
      });
      return;
    }

    onNext();
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
              examples={examplePayNotes}
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

      {activeModal?.type === 'amount' && activeModal.reason === 'missing' && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          data-testid="amount-required-modal"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Amount required
              </h3>
              <p className="text-sm text-gray-700">
                Enter the total amount before continuing.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal?.type === 'amount' &&
        activeModal.reason === 'insufficient-funds' && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            data-testid="insufficient-funds-modal"
          >
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Insufficient funds
                </h3>
                <p className="text-sm text-gray-700">
                  The selected account does not have enough available balance.
                  Enter a smaller amount or fund the account first.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {activeModal?.type === 'destination' &&
        activeModal.context === 'standard' && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            data-testid="to-account-required-modal"
          >
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  To account issue
                </h3>
                <p className="text-sm text-gray-700">
                  {activeModal.reason === 'missing'
                    ? 'To account needs to be set before continuing.'
                    : activeModal.reason === 'invalid'
                    ? 'Recipient account must be exactly 10 digits.'
                    : 'Recipient account must be different from the source account.'}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {activeModal?.type === 'destination' &&
        activeModal.context === 'paynote' && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            data-testid="paynote-to-account-modal"
          >
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  To account needs attention
                </h3>
                <p className="text-sm text-gray-700">
                  {activeModal.reason === 'missing'
                    ? 'Add a recipient account now unless the PayNote logic populates it automatically.'
                    : activeModal.reason === 'invalid'
                    ? 'Provide a 10-digit recipient account unless the PayNote logic fills it automatically.'
                    : 'Ensure the recipient account differs from the source unless the PayNote logic adjusts it automatically.'}
                </p>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModal(null);
                      onNext();
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Proceed without it
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
