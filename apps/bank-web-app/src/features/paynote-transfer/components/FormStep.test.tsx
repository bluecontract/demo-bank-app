import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { FormStep } from './FormStep';
import type { TransferFormData } from '../../../lib/paynote';

const mockAuthState = vi.hoisted(() => ({
  user: { email: 'tester@example.com', userId: 'user-1' },
  isAuthenticated: true,
  isLoading: false,
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../../app/providers/AuthProvider.tsx', () => ({
  useAuth: () => mockAuthState,
}));

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

const today = new Date().toISOString().split('T')[0];

const setup = (initialData: TransferFormData = {}) => {
  const onNext = vi.fn();
  const onCancel = vi.fn();

  const Wrapper = () => {
    const [formData, setFormData] = useState<TransferFormData>({
      fromAccount: accounts[0].accountNumber,
      date: today,
      ...initialData,
    });

    return (
      <FormStep
        formData={formData}
        accounts={accounts}
        onFormDataChange={updates =>
          setFormData(prev => ({
            ...prev,
            ...updates,
          }))
        }
        onNext={onNext}
        onCancel={onCancel}
      />
    );
  };

  const utils = render(<Wrapper />);
  return { ...utils, onNext, onCancel };
};

describe('FormStep', () => {
  beforeEach(() => {
    mockAuthState.user = { email: 'tester@example.com', userId: 'user-1' };
  });

  it('shows a warning modal when the destination account is missing for standard transfers', async () => {
    const { onNext } = setup();

    const amountInput = screen.getByLabelText(/total amount to be paid/i);
    fireEvent.change(amountInput, { target: { value: '120.50' } });

    const nextButton = screen.getByRole('button', { name: /next/i });
    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);

    const modal = await screen.findByTestId('to-account-required-modal');
    expect(modal).toBeInTheDocument();
    expect(
      screen.getByText(/to account needs to be set before continuing/i)
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(
        screen.queryByText(/to account needs to be set before continuing/i)
      ).not.toBeInTheDocument()
    );
  });

  it('proceeds when the destination account is provided for standard transfers', async () => {
    const { onNext } = setup();

    fireEvent.change(screen.getByLabelText(/total amount to be paid/i), {
      target: { value: '150.00' },
    });

    fireEvent.change(screen.getByLabelText(/^to account$/i), {
      target: { value: '9876543210' },
    });

    const nextButton = screen.getByRole('button', { name: /next/i });
    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('shows a warning when the destination account is missing for paynote transfers but still allows proceeding', async () => {
    const { onNext } = setup({
      isPayNoteEnabled: true,
      totalAmount: '200.00',
    });

    const nextButton = screen.getByRole('button', { name: /next/i });
    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);

    await screen.findByTestId('paynote-to-account-modal');
    expect(
      screen.getByText(
        /add a recipient account now unless the paynote logic populates it automatically/i
      )
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: /^proceed without it$/i })
    );
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('provides precise feedback when the destination account format is invalid', async () => {
    const { onNext } = setup();

    fireEvent.change(screen.getByLabelText(/total amount to be paid/i), {
      target: { value: '150.00' },
    });

    fireEvent.change(screen.getByLabelText(/^to account$/i), {
      target: { value: '12345' },
    });

    const nextButton = screen.getByRole('button', { name: /next/i });
    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);

    await screen.findByTestId('to-account-required-modal');
    expect(
      screen.getByText(/recipient account must be exactly 10 digits/i)
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('shows an amount modal when total amount is missing', async () => {
    const { onNext } = setup();

    const nextButton = screen.getByRole('button', { name: /next/i });
    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);

    await screen.findByTestId('amount-required-modal');
    expect(
      screen.getByText(/enter the total amount before continuing/i)
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(
        screen.queryByText(/enter the total amount before continuing/i)
      ).not.toBeInTheDocument()
    );
  });

  it('blocks progression when PayNote code is invalid base64', async () => {
    setup({ isPayNoteEnabled: true, totalAmount: '300.00' });

    const payNoteInput = screen.getByPlaceholderText(/enter paynote code/i);
    fireEvent.change(payNoteInput, { target: { value: 'invalid%%%' } });
    fireEvent.blur(payNoteInput);

    expect(
      await screen.findByText(/invalid paynote code format/i)
    ).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });
});
