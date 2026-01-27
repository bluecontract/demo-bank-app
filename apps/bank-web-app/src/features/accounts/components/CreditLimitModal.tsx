import { useEffect, useMemo, useState } from 'react';
import { useSetCreditLimit } from '../hooks/useSetCreditLimit';
import { formatCurrency } from '../../../lib/formatCurrency';
import { Account } from '../../../types/api';
import { Button } from '../../../ui/Button';

interface CreditLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  defaultAccountId?: string;
}

interface CreditLimitFormData {
  accountId: string;
  creditLimit: string;
}

type ModalView = 'form' | 'confirmation';

type ErrorState = Partial<Record<'creditLimit' | 'accountId', string>>;

const extractErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const maybeError = error as { body?: unknown; message?: string };
  if (maybeError.body && typeof maybeError.body === 'object') {
    const bodyWithMessage = maybeError.body as { message?: unknown };
    if (typeof bodyWithMessage.message === 'string') {
      return bodyWithMessage.message;
    }
  }
  if (typeof maybeError.message === 'string') {
    return maybeError.message;
  }
  return undefined;
};

export function CreditLimitModal({
  isOpen,
  onClose,
  accounts,
  defaultAccountId,
}: CreditLimitModalProps) {
  const creditLineAccounts = useMemo(
    () => accounts.filter(account => account.accountType === 'CREDIT_LINE'),
    [accounts]
  );

  const [currentView, setCurrentView] = useState<ModalView>('form');
  const [formData, setFormData] = useState<CreditLimitFormData>({
    accountId: '',
    creditLimit: '',
  });
  const [errors, setErrors] = useState<ErrorState>({});
  const [updatedAccount, setUpdatedAccount] = useState<Account | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const defaultAccount =
      creditLineAccounts.find(
        account => account.accountId === defaultAccountId
      ) ?? creditLineAccounts[0];

    setCurrentView('form');
    setUpdatedAccount(null);
    setErrors({});
    setFormData({
      accountId: defaultAccount?.accountId ?? '',
      creditLimit: '',
    });
  }, [isOpen, defaultAccountId, creditLineAccounts]);

  const selectedAccount = creditLineAccounts.find(
    account => account.accountId === formData.accountId
  );

  const setCreditLimit = useSetCreditLimit({
    onSuccess: account => {
      setUpdatedAccount(account);
      setCurrentView('confirmation');
    },
    onError: error => {
      const message =
        extractErrorMessage(error) ??
        (error instanceof Error
          ? error.message
          : 'Failed to update credit limit');
      setErrors({ creditLimit: message });
    },
  });

  const validateAmount = (value: string): string | undefined => {
    if (!value) return 'Credit limit is required';

    const decimalRegex = /^\d+(\.\d{1,2})?$/;
    if (!decimalRegex.test(value)) {
      return 'Credit limit must be a valid number with up to 2 decimal places';
    }

    const numValue = parseFloat(value);
    if (numValue < 0) return 'Credit limit must be zero or positive';

    return undefined;
  };

  const handleAmountChange = (value: string) => {
    const cleanValue = value.replace(/^\$/, '');
    const sanitized = cleanValue.replace(/[^0-9.]/g, '');
    const parts = sanitized.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    if (sanitized.length > 1 && sanitized[0] === '0' && sanitized[1] !== '.')
      return;

    setFormData(prev => ({ ...prev, creditLimit: sanitized }));

    if (errors.creditLimit) {
      setErrors(prev => ({ ...prev, creditLimit: undefined }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.accountId) {
      setErrors({ accountId: 'Select a credit line account' });
      return;
    }

    const amountError = validateAmount(formData.creditLimit);
    if (amountError) {
      setErrors({ creditLimit: amountError });
      return;
    }

    const creditLimitMinor = Math.round(parseFloat(formData.creditLimit) * 100);

    setCreditLimit.mutate({
      accountId: formData.accountId,
      creditLimitMinor,
    });
  };

  const handleClose = () => {
    setCurrentView('form');
    setUpdatedAccount(null);
    setFormData({
      accountId: '',
      creditLimit: '',
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
      data-testid="credit-limit-modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="credit-limit-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          {creditLineAccounts.length === 0 ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Credit line unavailable
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  No credit line accounts are available to update right now.
                </p>
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : currentView === 'confirmation' ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Credit limit updated
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Your credit line has been refreshed with the new limit.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <p className="text-sm text-emerald-800">
                  <span className="font-semibold">New limit:</span>{' '}
                  {updatedAccount?.creditLimitMinor !== undefined
                    ? formatCurrency(updatedAccount.creditLimitMinor)
                    : '--'}
                </p>
                <p className="text-sm text-emerald-800 mt-2">
                  <span className="font-semibold">Remaining credit:</span>{' '}
                  {updatedAccount
                    ? formatCurrency(updatedAccount.availableBalanceMinor)
                    : '--'}
                </p>
              </div>

              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Edit credit limit
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Adjust the total credit line available for this account.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="creditLineAccount"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Credit line account
                  </label>
                  <div className="mt-1">
                    <select
                      id="creditLineAccount"
                      value={formData.accountId}
                      onChange={event => {
                        setFormData(prev => ({
                          ...prev,
                          accountId: event.target.value,
                        }));
                        if (errors.accountId) {
                          setErrors(prev => ({
                            ...prev,
                            accountId: undefined,
                          }));
                        }
                      }}
                      className={`w-full px-3 py-2.5 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] border-slate-200 text-slate-900 bg-white/80 appearance-none ${
                        errors.accountId ? 'border-red-300' : 'border-slate-200'
                      }`}
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 0.5rem center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '1.5em 1.5em',
                        paddingRight: '2.5rem',
                      }}
                      required
                    >
                      {creditLineAccounts.map(account => (
                        <option
                          key={account.accountId}
                          value={account.accountId}
                          style={{ backgroundColor: 'white', color: 'black' }}
                        >
                          {account.name} ({account.accountNumber})
                        </option>
                      ))}
                    </select>
                    {errors.accountId && (
                      <p className="mt-1 text-sm text-red-600">
                        {errors.accountId}
                      </p>
                    )}
                  </div>
                </div>

                {selectedAccount && (
                  <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700 space-y-2">
                    <p>
                      <span className="font-medium">Current limit:</span>{' '}
                      {selectedAccount.creditLimitMinor !== undefined
                        ? formatCurrency(selectedAccount.creditLimitMinor)
                        : '--'}
                    </p>
                    <p>
                      <span className="font-medium">Remaining credit:</span>{' '}
                      {formatCurrency(selectedAccount.availableBalanceMinor)}
                    </p>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="creditLimit"
                    className="block text-sm font-medium text-slate-700"
                  >
                    New credit limit
                  </label>
                  <input
                    id="creditLimit"
                    type="text"
                    value={
                      formData.creditLimit ? `$${formData.creditLimit}` : ''
                    }
                    onChange={event => handleAmountChange(event.target.value)}
                    placeholder="$0"
                    className={`mt-1 w-full px-3 py-2.5 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] ${
                      errors.creditLimit ? 'border-red-300' : 'border-slate-200'
                    }`}
                    required
                  />
                  {errors.creditLimit && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.creditLimit}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={handleClose}
                  disabled={setCreditLimit.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={setCreditLimit.isPending}
                >
                  {setCreditLimit.isPending ? 'Updating...' : 'Update limit'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
