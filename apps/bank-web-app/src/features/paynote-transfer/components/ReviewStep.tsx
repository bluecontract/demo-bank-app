import { useEffect, useRef, useState } from 'react';
import {
  decodePayNoteBase64AsObject,
  decodePayNoteBase64AsYaml,
  TransferFormData,
} from '../../../lib/paynote';
import { PayNoteCodeInput } from './PayNoteCodeInput.tsx';
import { PayNoteDetails } from './PayNoteDetails.tsx';
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import { useApiClient } from '../../../app/providers/ApiProvider';
import { Markdown } from '../../../ui/Markdown';

interface Account {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
}

interface ValidationResult {
  validationScore?: number;
  explanation?: string;
}

interface ReviewStepProps {
  formData: TransferFormData;
  accounts: Account[];
  onFormDataChange: (updates: Partial<TransferFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  onCancel: () => void;
}

const MIN_PROCEED_SCORE = 5;

export function ReviewStep({
  formData,
  accounts,
  onFormDataChange,
  onNext,
  onBack,
  onCancel,
}: ReviewStepProps) {
  const apiClient = useApiClient();
  const isPayNoteEnabled = formData.isPayNoteEnabled ?? false;
  const [isValidating, setIsValidating] = useState(isPayNoteEnabled);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(
      isPayNoteEnabled ? null : { validationScore: MIN_PROCEED_SCORE }
    );
  const [canProceed, setCanProceed] = useState(!isPayNoteEnabled);
  const hasValidated = useRef(!isPayNoteEnabled);
  const explanationRef = useRef<HTMLDivElement>(null);

  const payNote =
    isPayNoteEnabled && formData.payNoteCode
      ? decodePayNoteBase64AsObject(formData.payNoteCode)
      : null;

  const amount = payNote?.amount?.total
    ? (payNote.amount.total / 100).toFixed(2)
    : formData.totalAmount
    ? Number(formData.totalAmount).toFixed(2)
    : '0.00';

  const isTransactionDetermined = Boolean(formData.toAccount);
  const amountPrefix = isTransactionDetermined ? '$' : 'Max. $';
  const hasAnyDetails = Boolean(
    formData.recipientName || formData.toAccount || formData.title
  );
  const isMissingSomeDetails = !formData.recipientName || !formData.toAccount;

  useEffect(() => {
    if (!hasValidated.current) {
      hasValidated.current = true; // Prevent double validation
      if (isPayNoteEnabled && formData.payNoteCode) {
        validatePayNote();
      } else {
        setIsValidating(false);
        setCanProceed(true);
      }
    }
  }, [formData, isPayNoteEnabled]);

  useEffect(() => {
    if (explanationRef.current) {
      explanationRef.current.scrollTop = explanationRef.current.scrollHeight;
    }
  }, [validationResult?.explanation]);

  const validatePayNote = async () => {
    if (!isPayNoteEnabled || !formData.payNoteCode) {
      setIsValidating(false);
      setCanProceed(true);
      setValidationResult(
        isPayNoteEnabled ? null : { validationScore: MIN_PROCEED_SCORE }
      );
      return;
    }

    setIsValidating(true);

    try {
      // Decode PayNote to YAML content
      const yamlContent = decodePayNoteBase64AsYaml(formData.payNoteCode);

      // Call validation API using typed client
      const response = await apiClient.banking.validatePayNote({
        body: {
          yamlContent,
          formData: {
            fromAccount: formData.fromAccount,
            toAccount: formData.toAccount,
            recipientName: formData.recipientName,
            totalAmount: formData.totalAmount,
            title: formData.title,
            payNoteCode: formData.payNoteCode,
          },
        },
      });

      if (response.status !== 200) {
        throw new Error('Validation request failed');
      }

      const result: ValidationResult = {
        validationScore: response.body.validationScore,
        explanation: response.body.explanation,
      };

      setValidationResult(result);
      setCanProceed((result.validationScore ?? 0) >= MIN_PROCEED_SCORE);
    } catch (error) {
      console.error('Validation error:', error);

      const fallback: ValidationResult = {
        validationScore: 0,
        explanation: 'The submitted PayNote could not be validated.',
      };

      setValidationResult(fallback);
      setCanProceed((fallback.validationScore ?? 0) >= MIN_PROCEED_SCORE);
    } finally {
      setIsValidating(false);
    }
  };

  const validationScore =
    validationResult?.validationScore ?? MIN_PROCEED_SCORE;
  const isRejected = isPayNoteEnabled && validationScore < MIN_PROCEED_SCORE;

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-slate-200 px-8 py-4 flex flex-col items-center justify-center text-center relative">
        <button
          onClick={onBack}
          className="absolute left-8 p-2 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-bold text-lg">Review Transfer Details</span>
        <span className="mt-1 text-sm text-gray-600">
          Validate your entries and we will complete the remaining checks.
        </span>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="grid md:grid-cols-2 gap-8 p-8 items-start flex-1">
          {/* Left Column - Transfer Summary */}
          <div className="rounded-xl border border-slate-200 p-8 shadow-lg">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="from-account-select"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  From account
                </label>
                <select
                  id="from-account-select"
                  value={formData.fromAccount ?? ''}
                  onChange={e =>
                    onFormDataChange({ fromAccount: e.target.value })
                  }
                  className="w-full p-3 border border-slate-300 rounded-lg text-gray-900 flex items-center justify-between"
                >
                  {accounts.map(account => (
                    <option
                      key={account.accountNumber}
                      value={account.accountNumber}
                    >
                      {account.name} - {account.accountNumber}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 block text-sm font-medium text-gray-700">
                  Total amount to be paid:
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 transform text-3xl font-bold text-gray-900">
                    {amountPrefix}
                  </span>
                  <div
                    className={`w-full rounded-lg border border-slate-300 p-4 text-3xl font-bold text-gray-900 ${
                      isTransactionDetermined ? 'pl-12' : 'pl-28'
                    }`}
                  >
                    {amount}
                  </div>
                </div>
              </div>

              {hasAnyDetails && (
                <>
                  <hr className="border-slate-200" />

                  <div className="space-y-3">
                    {formData.recipientName && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">
                          Recipient name:
                        </span>
                        <span className="font-medium text-gray-900">
                          {formData.recipientName}
                        </span>
                      </div>
                    )}
                    {formData.toAccount && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">
                          To account:
                        </span>
                        <span className="font-medium text-gray-900">
                          {formData.toAccount}
                        </span>
                      </div>
                    )}
                    {formData.title && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Title:</span>
                        <span className="font-medium text-gray-900">
                          {formData.title}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {isMissingSomeDetails && (
                <>
                  <hr className="border-slate-200" />
                  <div className="text-xl text-gray-900">
                    Necessary details not yet known:
                  </div>

                  <div className="space-y-3">
                    {!formData.recipientName && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">
                          Recipient name:
                        </span>
                        <span className="font-medium text-gray-900">-</span>
                      </div>
                    )}
                    {!formData.toAccount && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">
                          To account:
                        </span>
                        <span className="font-medium text-gray-900">-</span>
                      </div>
                    )}
                    {!isTransactionDetermined && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">
                          Total amount to be paid:
                        </span>
                        <span className="font-medium text-gray-900">-</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right Column - PayNote & Validation */}
          <div className="h-fit rounded-xl border border-slate-200 p-8 shadow-lg">
            {isPayNoteEnabled ? (
              <div className="space-y-4">
                <PayNoteCodeInput
                  enabled={isPayNoteEnabled}
                  value={formData.payNoteCode || ''}
                  disabled={true}
                />

                {formData.payNoteCode && (
                  <PayNoteDetails payNoteCode={formData.payNoteCode} />
                )}

                {validationResult && (
                  <div className="mt-6">
                    <div
                      className={`overflow-hidden rounded-lg border ${
                        isRejected ? 'border-red-500' : 'border-slate-900'
                      }`}
                    >
                      <div className="flex items-start space-x-3 p-4 pb-2">
                        {isRejected && (
                          <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h3
                              className={`text-sm font-semibold ${
                                isRejected ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              Bank Notice{isRejected && ' - PayNote Rejected'}
                            </h3>
                            <span
                              className={`rounded px-2 py-1 text-xs font-mono font-semibold ${
                                isRejected
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              Score: {validationScore}/10
                            </span>
                          </div>
                        </div>
                      </div>
                      {validationResult.explanation && (
                        <div
                          ref={explanationRef}
                          className="max-h-[250px] overflow-y-auto px-4 pb-4 pt-2"
                        >
                          <div className={isRejected ? 'pl-9' : ''}>
                            <Markdown>{validationResult.explanation}</Markdown>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Standard Transfer
                </h3>
                <p className="text-sm text-gray-600">
                  No PayNote was attached. This transfer will be processed
                  immediately using the standard banking workflow once you
                  authorize it on the next step.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-8 py-3 flex justify-end space-x-3 mt-auto">
        <button
          onClick={onCancel}
          className="px-6 py-2 border border-green-500 text-green-500 rounded-full font-semibold hover:bg-green-50 transition-colors sm:px-20"
        >
          Cancel
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed || isValidating}
          className={`flex items-center justify-center gap-2 rounded-full px-8 py-2 font-semibold transition-all sm:px-24 ${
            canProceed && !isValidating
              ? 'cursor-pointer bg-gradient-to-l from-green-500 to-yellow-400 text-white hover:opacity-90'
              : 'cursor-not-allowed bg-slate-300 opacity-60 text-gray-500'
          }`}
        >
          {isValidating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating...
            </>
          ) : (
            'Next'
          )}
        </button>
      </div>
    </div>
  );
}
