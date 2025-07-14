import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { TransferForm } from './TransferForm';

describe('TransferForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    onSubmit: mockOnSubmit,
    onCancel: mockOnCancel,
    isLoading: false,
    error: null,
    mode: 'transfer' as const,
    sourceAccount: {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      accountNumber: '1234567890',
      availableBalanceMinor: 100000,
      currency: 'USD',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transfer form with all required fields', () => {
    render(<TransferForm {...defaultProps} />);

    expect(
      screen.getByLabelText(/destination account number/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /transfer/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('renders fund form without destination account field', () => {
    render(<TransferForm {...defaultProps} mode="fund" />);

    expect(
      screen.queryByLabelText(/destination account number/i)
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /fund account/i })
    ).toBeInTheDocument();
  });

  it('validates account number format for transfer mode', async () => {
    render(<TransferForm {...defaultProps} />);

    const accountInput = screen.getByLabelText(/destination account number/i);
    const submitButton = screen.getByRole('button', { name: /transfer/i });

    fireEvent.change(accountInput, { target: { value: '123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/account number must be 10 digits/i)
      ).toBeInTheDocument();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates amount is positive', async () => {
    render(<TransferForm {...defaultProps} />);

    const amountInput = screen.getByLabelText(/amount/i);
    const destinationInput = screen.getByLabelText(
      /destination account number/i
    );
    const submitButton = screen.getByRole('button', { name: /transfer/i });

    // Fill in required fields first
    fireEvent.change(destinationInput, { target: { value: '1234567890' } });
    fireEvent.change(amountInput, { target: { value: '-10' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/amount must be positive/i)).toBeInTheDocument();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates amount does not exceed available balance', async () => {
    render(<TransferForm {...defaultProps} />);

    const amountInput = screen.getByLabelText(/amount/i);
    const submitButton = screen.getByRole('button', { name: /transfer/i });

    fireEvent.change(amountInput, { target: { value: '2000' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/insufficient funds/i)).toBeInTheDocument();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates description length', async () => {
    render(<TransferForm {...defaultProps} />);

    const descriptionInput = screen.getByLabelText(/description/i);
    const submitButton = screen.getByRole('button', { name: /transfer/i });

    const longDescription = 'a'.repeat(141);
    fireEvent.change(descriptionInput, { target: { value: longDescription } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/description must be 140 characters or less/i)
      ).toBeInTheDocument();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits valid transfer form', async () => {
    render(<TransferForm {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination account number/i), {
      target: { value: '9876543210' },
    });
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Test transfer' },
    });

    fireEvent.click(screen.getByRole('button', { name: /transfer/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
        destinationAccountNumber: '9876543210',
        amountMinor: 10000,
        description: 'Test transfer',
      });
    });
  });

  it('submits valid fund form', async () => {
    render(<TransferForm {...defaultProps} mode="fund" />);

    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: '250' },
    });

    fireEvent.click(screen.getByRole('button', { name: /fund account/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        amountMinor: 25000,
      });
    });
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<TransferForm {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('displays loading state', () => {
    render(<TransferForm {...defaultProps} isLoading={true} />);

    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('displays error message', () => {
    const error = 'Transfer failed';
    render(<TransferForm {...defaultProps} error={error} />);

    expect(screen.getByText(error)).toBeInTheDocument();
  });

  it('formats currency input correctly', () => {
    render(<TransferForm {...defaultProps} />);

    const amountInput = screen.getByLabelText(/amount/i);

    fireEvent.change(amountInput, { target: { value: '123.45' } });

    expect(amountInput).toHaveValue(123.45);
  });

  it('shows available balance for source account', () => {
    render(<TransferForm {...defaultProps} />);

    expect(screen.getByText(/available: \$1,000/i)).toBeInTheDocument();
  });
});
