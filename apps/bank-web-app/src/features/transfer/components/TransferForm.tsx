import { useState, FormEvent, ChangeEvent } from 'react';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { formatCurrency } from '../../../lib/formatCurrency';

interface SourceAccount {
  accountId: string;
  accountNumber: string;
  availableBalanceMinor: number;
  currency: string;
}

interface TransferFormData {
  sourceAccountId: string;
  destinationAccountNumber: string;
  amountMinor: number;
  description?: string;
}

interface FundFormData {
  accountId: string;
  amountMinor: number;
  description?: string;
}

interface TransferFormProps {
  onSubmit: (data: TransferFormData | FundFormData) => void;
  onCancel: () => void;
  isLoading: boolean;
  error: string | null;
  mode: 'transfer' | 'fund';
  sourceAccount: SourceAccount;
}

interface FormErrors {
  destinationAccountNumber?: string;
  amount?: string;
  description?: string;
}

export function TransferForm({
  onSubmit,
  onCancel,
  isLoading,
  error,
  mode,
  sourceAccount,
}: TransferFormProps) {
  const [destinationAccountNumber, setDestinationAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (mode === 'transfer') {
      if (!destinationAccountNumber) {
        newErrors.destinationAccountNumber =
          'Destination account number is required';
      } else if (!/^\d{10}$/.test(destinationAccountNumber)) {
        newErrors.destinationAccountNumber = 'Account number must be 10 digits';
      }
    }

    if (!amount) {
      newErrors.amount = 'Amount is required';
    } else {
      const amountValue = parseFloat(amount);
      if (isNaN(amountValue) || amountValue <= 0) {
        newErrors.amount = 'Amount must be positive';
      } else {
        const amountMinor = Math.round(amountValue * 100);
        if (amountMinor > sourceAccount.availableBalanceMinor) {
          newErrors.amount = 'Insufficient funds';
        }
      }
    }

    if (description && description.length > 140) {
      newErrors.description = 'Description must be 140 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const amountMinor = Math.round(parseFloat(amount) * 100);

    if (mode === 'transfer') {
      onSubmit({
        sourceAccountId: sourceAccount.accountId,
        destinationAccountNumber,
        amountMinor,
        description: description || undefined,
      });
    } else {
      onSubmit({
        accountId: sourceAccount.accountId,
        amountMinor,
      });
    }
  };

  const handleInputChange = (field: string, value: string) => {
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }

    switch (field) {
      case 'destinationAccountNumber':
        setDestinationAccountNumber(value);
        break;
      case 'amount':
        setAmount(value);
        break;
      case 'description':
        setDescription(value);
        break;
    }
  };

  const availableBalance = sourceAccount.availableBalanceMinor;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {mode === 'transfer' ? 'Transfer Money' : 'Fund Account'}
          </h3>
          <p className="text-sm text-gray-600">
            From account: {sourceAccount.accountNumber}
          </p>
          <p className="text-sm text-gray-600">
            Available: {formatCurrency(availableBalance)}
          </p>
        </div>

        {mode === 'transfer' && (
          <div>
            <label
              htmlFor="destinationAccountNumber"
              className="block text-sm font-medium text-gray-700"
            >
              Destination Account Number
            </label>
            <Input
              id="destinationAccountNumber"
              type="text"
              value={destinationAccountNumber}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleInputChange('destinationAccountNumber', e.target.value)
              }
              placeholder="Enter 10-digit account number"
              maxLength={10}
              disabled={isLoading}
              error={errors.destinationAccountNumber}
            />
          </div>
        )}

        <div>
          <label
            htmlFor="amount"
            className="block text-sm font-medium text-gray-700 text-center mb-4"
          >
            Amount
          </label>
          <div className="text-center mb-4">
            <div className="text-4xl font-bold text-gray-900 mb-2">
              {amount ? `$${parseFloat(amount).toFixed(0)}` : '$0'}
            </div>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleInputChange('amount', e.target.value)
              }
              placeholder="0.00"
              disabled={isLoading}
              error={errors.amount}
              className="text-center text-lg font-medium"
            />
          </div>
        </div>

        {mode === 'transfer' && (
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description (optional)
            </label>
            <Input
              id="description"
              type="text"
              value={description}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setDescription(e.target.value)
              }
              placeholder="Enter description"
              maxLength={140}
              disabled={isLoading}
              error={errors.description}
            />
            <p className="text-xs text-gray-500 mt-1">
              {description.length}/140 characters
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button disabled={isLoading} className="flex-1">
          {isLoading
            ? 'Processing...'
            : mode === 'transfer'
            ? 'Transfer'
            : 'Fund Account'}
        </Button>
      </div>
    </form>
  );
}
