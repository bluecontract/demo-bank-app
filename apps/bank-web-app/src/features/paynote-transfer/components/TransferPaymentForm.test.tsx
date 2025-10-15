import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { TransferPaymentForm } from './TransferPaymentForm';
import type { TransferFormData } from '../../../lib/paynote';

const accounts = [
  {
    accountId: 'account-1',
    accountNumber: '1234567890',
    name: 'Everyday Checking',
    currency: 'USD',
    ledgerBalanceMinor: 500000,
    availableBalanceMinor: 350000,
    status: 'ACTIVE',
  },
];

describe('TransferPaymentForm', () => {
  it('emits value changes for each controlled field', () => {
    const onValuesChange = vi.fn<(values: TransferFormData) => void>();

    render(
      <TransferPaymentForm
        initialValues={{ fromAccount: 'account-1' }}
        accounts={accounts}
        onValuesChange={onValuesChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/total amount to be paid/i), {
      target: { value: '75.00' },
    });
    fireEvent.change(screen.getByLabelText(/recipient name/i), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByLabelText(/^to account$/i), {
      target: { value: '9876543210' },
    });

    expect(onValuesChange).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: '75.00',
        recipientName: 'Alice',
        toAccount: '9876543210',
      })
    );
  });

  it('sanitises the destination account input to 10 digits', () => {
    const onValuesChange = vi.fn();

    render(
      <TransferPaymentForm
        initialValues={{ fromAccount: 'account-1' }}
        accounts={accounts}
        onValuesChange={onValuesChange}
      />
    );

    const toAccountInput = screen.getByLabelText(
      /^to account$/i
    ) as HTMLInputElement;
    fireEvent.change(toAccountInput, {
      target: { value: '123abc4567890' },
    });

    expect(toAccountInput.value).toBe('1234567890');
    expect(onValuesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ toAccount: '1234567890' })
    );
  });

  it('updates displayed values when initial values change', () => {
    const onValuesChange = vi.fn();

    const { rerender } = render(
      <TransferPaymentForm
        initialValues={{ fromAccount: 'account-1', totalAmount: '10.00' }}
        accounts={accounts}
        onValuesChange={onValuesChange}
      />
    );

    expect(
      (screen.getByLabelText(/total amount to be paid/i) as HTMLInputElement)
        .value
    ).toBe('10.00');

    rerender(
      <TransferPaymentForm
        initialValues={{ fromAccount: 'account-1', totalAmount: '25.50' }}
        accounts={accounts}
        onValuesChange={onValuesChange}
      />
    );

    expect(
      (screen.getByLabelText(/total amount to be paid/i) as HTMLInputElement)
        .value
    ).toBe('25.50');
  });
});
