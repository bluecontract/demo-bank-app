import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { TransferFormData } from '../../../lib/paynote';

interface Account {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
}

interface TransferPaymentFormProps {
  initialValues?: TransferFormData;
  accounts: Account[];
  onValuesChange?: (values: TransferFormData) => void;
}

export function TransferPaymentForm({
  initialValues,
  accounts,
  onValuesChange,
}: TransferPaymentFormProps) {
  const [values, setValues] = useState<TransferFormData>(initialValues ?? {});

  // Update form values when initialValues prop changes
  useEffect(() => {
    if (initialValues) {
      setValues(initialValues);
    }
  }, [initialValues]);

  const handleValueChange = (field: keyof TransferFormData, value: string) => {
    const newValues = { ...values, [field]: value };
    setValues(newValues);
    onValuesChange?.(newValues);
  };

  return (
    <div className="space-y-4">
      {/* From Account */}
      <div>
        <label
          htmlFor="fromAccount"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          From account
        </label>
        <select
          id="fromAccount"
          value={values.fromAccount ?? ''}
          onChange={e => handleValueChange('fromAccount', e.target.value)}
          className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
        >
          <option value="">Select account</option>
          {accounts.map(account => (
            <option key={account.accountNumber} value={account.accountNumber}>
              {account.name} - {account.accountNumber} ($
              {(account.availableBalanceMinor / 100).toFixed(2)})
            </option>
          ))}
        </select>
      </div>

      {/* Total Amount */}
      <div>
        <label
          htmlFor="totalAmount"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Total amount to be paid
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-3xl font-bold text-gray-900">
            $
          </span>
          <input
            id="totalAmount"
            type="number"
            placeholder="0.00"
            value={values.totalAmount ?? ''}
            min="0"
            step="0.01"
            onChange={e => {
              let value = e.target.value;
              if (value.includes('.')) {
                const parts = value.split('.');
                if (parts[1] && parts[1].length > 2) {
                  value = parts[0] + '.' + parts[1].slice(0, 2);
                }
              }
              handleValueChange('totalAmount', value);
            }}
            className="w-full p-4 pl-10 text-3xl font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 placeholder-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      {/* Recipient Name */}
      <div>
        <label
          htmlFor="recipientName"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Recipient name
        </label>
        <div className="relative">
          <input
            id="recipientName"
            type="text"
            placeholder="Enter recipient name"
            value={values.recipientName ?? ''}
            onChange={e => handleValueChange('recipientName', e.target.value)}
            className="w-full p-3 pr-12 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 placeholder-slate-400"
          />
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        </div>
      </div>

      {/* To Account */}
      <div>
        <label
          htmlFor="toAccount"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          To account
        </label>
        <input
          id="toAccount"
          type="text"
          placeholder="Enter valid account number"
          value={values.toAccount ?? ''}
          inputMode="numeric"
          title="Please enter a valid 10-digit account number"
          onChange={e => {
            const value = e.target.value.replace(/\D/g, '').slice(0, 10);
            handleValueChange('toAccount', value);
          }}
          className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 placeholder-slate-400"
        />
      </div>

      {/* Title */}
      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Title
        </label>
        <input
          id="title"
          type="text"
          placeholder="Enter payment title"
          value={values.title ?? ''}
          onChange={e => handleValueChange('title', e.target.value)}
          className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 placeholder-slate-400"
        />
      </div>

      {/* Date */}
      <div>
        <label
          htmlFor="date"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Date
        </label>
        <input
          id="date"
          type="date"
          min={new Date().toISOString().split('T')[0]}
          value={values.date ?? new Date().toISOString().split('T')[0]}
          onChange={e => handleValueChange('date', e.target.value)}
          className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
        />
      </div>
    </div>
  );
}
