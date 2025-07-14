import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionDetails } from './TransactionDetails';
import { TransactionDetails as TransactionDetailsType } from '../hooks/useTransaction';

vi.mock('../../../lib/formatCurrency', () => ({
  formatCurrency: vi.fn((amount: number) => `$${(amount / 100).toFixed(2)}`),
}));

vi.mock('../../../lib/formatAccountNumber', () => ({
  formatAccountNumber: vi.fn((number: string) => `**** ${number.slice(-4)}`),
}));

const mockTransaction: TransactionDetailsType = {
  txnId: 'txn-123',
  accountId: 'acc-123',
  side: 'DEBIT',
  amountMinor: 1000,
  type: 'TRANSFER',
  status: 'POSTED',
  timestamp: '2024-01-01T00:00:00.000Z',
  description: 'Test transaction description',
  counterpartyAccountNumber: '0987654321',
};

describe('TransactionDetails', () => {
  const defaultProps = {
    transaction: mockTransaction,
    currentAccountId: 'acc-123',
    currentAccountNumber: '1234567890',
  };

  it('should render transaction details for outgoing transfer', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(
      screen.getByRole('heading', { name: 'Outgoing transfer' })
    ).toBeInTheDocument();
    expect(screen.getByText('-$10.00')).toBeInTheDocument();
    expect(screen.getByText('Standard Transfer')).toBeInTheDocument();
    expect(screen.getAllByText('01/01/2024')).toHaveLength(2); // Date appears twice
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });

  it('should render transaction details for incoming transfer', () => {
    const incomingTransaction = {
      ...mockTransaction,
      side: 'CREDIT' as const,
      counterpartyAccountNumber: '9876543210',
    };

    render(
      <TransactionDetails {...defaultProps} transaction={incomingTransaction} />
    );

    expect(
      screen.getByRole('heading', { name: 'Incoming transfer' })
    ).toBeInTheDocument();
    expect(screen.getByText('+$10.00')).toBeInTheDocument();
    expect(screen.getByText('To: **** 7890')).toBeInTheDocument(); // Shows where money landed
  });

  it('should display transaction status correctly', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('should display completed status correctly', () => {
    const completedTransaction = {
      ...mockTransaction,
      status: 'COMPLETED',
    };

    render(
      <TransactionDetails
        {...defaultProps}
        transaction={completedTransaction}
      />
    );

    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('should display description when provided', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(
      screen.getByText('Test transaction description')
    ).toBeInTheDocument();
  });

  it('should not display description section when not provided', () => {
    const transactionWithoutDescription = {
      ...mockTransaction,
      description: undefined,
    };

    render(
      <TransactionDetails
        {...defaultProps}
        transaction={transactionWithoutDescription}
      />
    );

    expect(screen.queryByText('Description')).not.toBeInTheDocument();
  });

  it('should display correct account information for outgoing transfer', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('**** 7890')).toBeInTheDocument(); // Current account appears
    expect(screen.getByText('**** 4321')).toBeInTheDocument(); // Counterparty account appears
  });

  it('should display correct account information for incoming transfer', () => {
    const incomingTransaction = {
      ...mockTransaction,
      side: 'CREDIT' as const,
      counterpartyAccountNumber: '9876543210',
    };

    render(
      <TransactionDetails {...defaultProps} transaction={incomingTransaction} />
    );

    expect(screen.getByText('**** 7890')).toBeInTheDocument(); // Current account appears
    expect(screen.getByText('**** 3210')).toBeInTheDocument(); // Counterparty account appears
  });

  it('should display payment number as transaction ID', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Payment number')).toBeInTheDocument();
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });

  it('should handle different status types with correct styling', () => {
    const { rerender } = render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Completed')).toHaveClass(
      'bg-green-100',
      'text-green-800'
    );

    const failedTransaction = {
      ...mockTransaction,
      status: 'FAILED',
    };

    rerender(
      <TransactionDetails {...defaultProps} transaction={failedTransaction} />
    );

    expect(screen.getByText('FAILED')).toHaveClass(
      'bg-red-100',
      'text-red-800'
    );
  });

  it('should apply correct test id when provided', () => {
    render(
      <TransactionDetails
        {...defaultProps}
        data-testid="test-transaction-details"
      />
    );

    expect(screen.getByTestId('test-transaction-details')).toBeInTheDocument();
  });
});
