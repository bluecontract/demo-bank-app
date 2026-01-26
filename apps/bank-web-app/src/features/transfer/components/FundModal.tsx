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
  });

  // Reset form when modal opens with a new default account
  useEffect(() => {
    if (isOpen && defaultAccountId) {
      setFormData(prev => ({
        ...prev,
        accountId: defaultAccountId,
        amount: '',
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
    // Remove dollar sign if present
    const cleanValue = value.replace(/^\$/, '');

    // Allow only digits and one decimal point
    const sanitized = cleanValue.replace(/[^0-9.]/g, '');

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
    });
  };

  const handleClose = () => {
    setCurrentView('form');
    setFormData({
      accountId: defaultAccountId || accounts[0]?.accountId || '',
      amount: '',
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
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-md w-full max-h-[90vh] overflow-y-auto"
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
                  <h3 className="text-lg font-semibold text-slate-900">
                    Fund Account
                  </h3>
                </div>

                {/* Account Selection */}
                <div>
                  <label
                    htmlFor="targetAccount"
                    className="block text-sm font-medium text-slate-700"
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
                      className="w-full px-3 py-2.5 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] border-slate-200 text-slate-900 bg-white/80 appearance-none"
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
                        <div className="mt-4 p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl">
                          <p className="text-sm text-emerald-700">
                            <span className="font-medium">Available:</span>{' '}
                            <span className="font-semibold text-emerald-900">
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
                    className="block text-sm font-medium text-slate-700 text-center mb-3"
                  >
                    Amount
                  </label>
                  <div className="text-center">
                    <input
                      type="text"
                      id="amount"
                      value={formData.amount ? `$${formData.amount}` : ''}
                      onChange={e => handleAmountChange(e.target.value)}
                      placeholder="$0"
                      className="w-full text-center text-4xl font-bold text-slate-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-slate-400 mb-5"
                      style={{
                        textAlign: 'center',
                        fontSize: '2.25rem',
                        fontWeight: 'bold',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        boxShadow: 'none',
                      }}
                      required
                    />
                    {errors.amount && (
                      <p className="text-red-600 text-sm mt-1">
                        {errors.amount}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-6 py-2 text-base font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 focus:ring-[var(--color-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fundAccount.isPending}
                  className="flex-1 px-6 py-2 text-base font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-600)] focus:ring-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
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
