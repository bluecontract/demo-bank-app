import { useState } from 'react';
import { useCreateAccount } from '../hooks/useCreateAccount';

interface AccountCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface AccountFormData {
  name: string;
}

export function AccountCreationModal({
  isOpen,
  onClose,
  onSuccess,
}: AccountCreationModalProps) {
  const [formData, setFormData] = useState<AccountFormData>({
    name: '',
  });
  const [errors, setErrors] = useState<Partial<AccountFormData>>({});

  const createAccount = useCreateAccount();

  const validateName = (value: string): string | undefined => {
    if (!value.trim()) return 'Account name is required';
    if (value.length > 100)
      return 'Account name must be 100 characters or less';
    return undefined;
  };

  const handleNameChange = (value: string) => {
    setFormData(prev => ({ ...prev, name: value }));

    // Clear error when user starts typing
    if (errors.name) {
      setErrors(prev => ({ ...prev, name: undefined }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const nameError = validateName(formData.name);
    if (nameError) {
      setErrors({ name: nameError });
      return;
    }

    createAccount.mutate(
      {
        name: formData.name.trim(),
      },
      {
        onSuccess: () => {
          handleClose();
          onSuccess?.();
        },
        onError: (error: Error) => {
          setErrors({ name: error.message });
        },
      }
    );
  };

  const handleClose = () => {
    setFormData({ name: '' });
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
        className="bg-white/90 rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-slate-200 backdrop-blur"
        onClick={e => e.stopPropagation()}
        data-testid="modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              {/* Header */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Create New Account
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Enter a name for your new account
                </p>
              </div>

              {/* Account Name Input */}
              <div>
                <label
                  htmlFor="accountName"
                  className="block text-sm font-medium text-slate-700"
                >
                  Account Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    id="accountName"
                    value={formData.name}
                    onChange={e => handleNameChange(e.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] ${
                      errors.name ? 'border-red-300' : 'border-slate-200'
                    }`}
                    placeholder="e.g., My Checking Account"
                    maxLength={100}
                    required
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]"
                disabled={createAccount.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] border border-transparent rounded-xl shadow-sm hover:bg-[var(--color-primary-600)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
                disabled={createAccount.isPending}
              >
                {createAccount.isPending ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
