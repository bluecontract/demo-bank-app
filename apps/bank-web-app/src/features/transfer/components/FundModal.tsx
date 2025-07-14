import { useState, useEffect } from 'react';
import { TransferConfirmation } from './TransferConfirmation';
import { useFundAccount } from '../hooks/useFundAccount';
import { formatCurrency } from '../../../lib/formatCurrency';

interface Account {
  accountId: string;
  accountNumber: string;
  availableBalanceMinor: number;
  currency: string;
}

interface FundModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  defaultAccountId?: string;
}

interface FundFormData {
  accountId: string;
  amount: string;
  description: string;
}

type ModalView = 'form' | 'confirmation';

export function FundModal({
  isOpen,
  onClose,
  accounts,
  defaultAccountId,
}: FundModalProps) {
  const [currentView, setCurrentView] = useState<ModalView>('form');
  const [formData, setFormData] = useState<FundFormData>({
    accountId: defaultAccountId || accounts[0]?.accountId || '',
    amount: '',
    description: '',
  });

  // Reset form when modal opens with a new default account
  useEffect(() => {
    if (isOpen && defaultAccountId) {
      setFormData(prev => ({
        ...prev,
        accountId: defaultAccountId,
        amount: '',
        description: '',
      }));
      setErrors({});
    }
  }, [isOpen, defaultAccountId]);
  const [errors, setErrors] = useState<Partial<FundFormData>>({});

  const fundAccount = useFundAccount({
    onSuccess: () => {
      setCurrentView('confirmation');
    },
    onError: error => {
      setErrors({ amount: error.message });
    },
  });

  const validateAmount = (value: string): string | undefined => {
    if (!value) return 'Amount is required';

    // Check for valid decimal format
    const decimalRegex = /^\d+(\.\d{1,2})?$/;
    if (!decimalRegex.test(value)) {
      return 'Amount must be a valid number with up to 2 decimal places';
    }

    const numValue = parseFloat(value);
    if (numValue <= 0) return 'Amount must be positive';

    return undefined;
  };

  const handleAmountChange = (value: string) => {
    // Allow only digits and one decimal point
    const sanitized = value.replace(/[^0-9.]/g, '');

    // Prevent multiple decimal points
    const parts = sanitized.split('.');
    if (parts.length > 2) return;

    // Limit to 2 decimal places
    if (parts[1] && parts[1].length > 2) return;

    // Prevent leading zeros (except for "0.")
    if (sanitized.length > 1 && sanitized[0] === '0' && sanitized[1] !== '.')
      return;

    setFormData(prev => ({ ...prev, amount: sanitized }));

    // Clear error when user starts typing
    if (errors.amount) {
      setErrors(prev => ({ ...prev, amount: undefined }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const amountError = validateAmount(formData.amount);
    if (amountError) {
      setErrors({ amount: amountError });
      return;
    }

    const amountMinor = Math.round(parseFloat(formData.amount) * 100);

    fundAccount.mutate({
      accountId: formData.accountId,
      amountMinor,
      description: formData.description || undefined,
    });
  };

  const handleClose = () => {
    setCurrentView('form');
    setFormData({
      accountId: defaultAccountId || accounts[0]?.accountId || '',
      amount: '',
      description: '',
    });
    setErrors({});
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="modal-backdrop"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          {currentView === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                {/* Header */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Fund Account
                  </h3>
                </div>

                {/* Account Selection */}
                <div>
                  <label
                    htmlFor="targetAccount"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Select Account
                  </label>
                  <div>
                    <select
                      id="targetAccount"
                      value={formData.accountId}
                      onChange={e =>
                        setFormData(prev => ({
                          ...prev,
                          accountId: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 border-gray-300 text-gray-900 bg-white appearance-none"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 0.5rem center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '1.5em 1.5em',
                        paddingRight: '2.5rem',
                      }}
                      required
                    >
                      {accounts.map(account => (
                        <option
                          key={account.accountId}
                          value={account.accountId}
                          style={{ backgroundColor: 'white', color: 'black' }}
                        >
                          {account.accountNumber}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const selectedAccount = accounts.find(
                        acc => acc.accountId === formData.accountId
                      );
                      return selectedAccount ? (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                          <p className="text-sm text-green-800">
                            <span className="font-medium">Available:</span>{' '}
                            <span className="font-semibold text-green-900">
                              {formatCurrency(
                                selectedAccount.availableBalanceMinor
                              )}
                            </span>
                          </p>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Amount Field */}
                <div>
                  <label
                    htmlFor="amount"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Amount
                  </label>
                  <div>
                    <input
                      type="text"
                      id="amount"
                      value={formData.amount}
                      onChange={e => handleAmountChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-green-500 bg-white"
                      required
                    />
                    {errors.amount && (
                      <p className="text-red-600 text-sm mt-1">
                        {errors.amount}
                      </p>
                    )}
                  </div>
                </div>

                {/* Description Field */}
                <div>
                  <label
                    htmlFor="description"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Description (optional)
                  </label>
                  <div>
                    <input
                      type="text"
                      id="description"
                      value={formData.description}
                      onChange={e =>
                        setFormData(prev => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      placeholder="Enter description"
                      maxLength={140}
                      className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-green-500 bg-white"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.description.length}/140 characters
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-6 py-2 text-base font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 border-2 border-green-600 text-green-600 bg-transparent hover:bg-green-50 focus:ring-green-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fundAccount.isPending}
                  className="flex-1 px-6 py-2 text-base font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fundAccount.isPending ? 'Adding Funds...' : 'Fund Account'}
                </button>
              </div>
            </form>
          ) : (
            <TransferConfirmation onHomeClick={handleClose} />
          )}
        </div>
      </div>
    </div>
  );
}
