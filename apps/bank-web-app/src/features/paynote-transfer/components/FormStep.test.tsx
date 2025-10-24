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

  it('requires standard transfer details before allowing users to proceed', async () => {
    const { onNext } = setup();

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/total amount to be paid/i), {
      target: { value: '120.50' },
    });

    fireEvent.change(screen.getByLabelText(/^to account$/i), {
      target: { value: '9876543210' },
    });

    await waitFor(() => expect(nextButton).toBeEnabled());

    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalled();
  });

  it('blocks progression when PayNote code is invalid base64', async () => {
    setup({ isPayNoteEnabled: true });

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
