import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionDetails } from './TransactionDetails';
import { TransactionDetails as TransactionDetailsType } from '../hooks/useTransaction';

vi.mock('../../../lib/formatCurrency', () => ({
  formatCurrency: vi.fn((amount: number) => `$${(amount / 100).toFixed(2)}`),
}));

vi.mock('../../../lib/formatAccountNumber', () => ({
  formatAccountNumber: vi.fn((number: string) => {
    if (!number) return '****';
    return `**** ${number.slice(-4)}`;
  }),
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

const mockAccounts = [
  {
    accountId: 'acc-123',
    accountNumber: '1234567890',
    name: 'Test Account 1',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 50000,
    availableBalanceMinor: 45000,
    status: 'active',
  },
  {
    accountId: 'acc-456',
    accountNumber: '0987654321',
    name: 'Test Account 2',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 30000,
    availableBalanceMinor: 30000,
    status: 'active',
  },
];

describe('TransactionDetails', () => {
  const defaultProps = {
    transaction: mockTransaction,
    currentAccountId: 'acc-123',
    currentAccountNumber: '1234567890',
    accounts: mockAccounts,
  };

  it('should render transaction details for outgoing transfer', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(
      screen.getByRole('heading', { name: 'Outgoing transfer' })
    ).toBeInTheDocument();
    expect(screen.getByText('-$10.00')).toBeInTheDocument();
    expect(screen.getByText('Standard Transfer')).toBeInTheDocument();
    expect(screen.getAllByText('01/01/2024')).toHaveLength(2);
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });

  it('should render transaction details for incoming transfer', () => {
    const incomingTransaction = {
      ...mockTransaction,
      side: 'CREDIT' as const,
      accountId: 'acc-456',
      counterpartyAccountNumber: '1234567890',
    };

    const props = {
      ...defaultProps,
      currentAccountId: 'acc-456',
      currentAccountNumber: '0987654321',
    };

    render(<TransactionDetails {...props} transaction={incomingTransaction} />);

    expect(
      screen.getByRole('heading', { name: 'Incoming transfer' })
    ).toBeInTheDocument();
    expect(screen.getByText('+$10.00')).toBeInTheDocument();
  });

  it('should display account names with account numbers', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(
      screen.getByText('To **** 4321 (Test Account 2)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('From: **** 7890 (Test Account 1)')
    ).toBeInTheDocument();
  });

  it('should display correct account information for incoming transfer with names', () => {
    const incomingTransaction = {
      ...mockTransaction,
      side: 'CREDIT' as const,
      accountId: 'acc-456',
      counterpartyAccountNumber: '1234567890',
    };

    const props = {
      ...defaultProps,
      currentAccountId: 'acc-456',
      currentAccountNumber: '0987654321',
    };

    render(<TransactionDetails {...props} transaction={incomingTransaction} />);

    expect(
      screen.getByText('From **** 7890 (Test Account 1)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('To: **** 4321 (Test Account 2)')
    ).toBeInTheDocument();
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

  it('should handle missing account names gracefully', () => {
    const propsWithoutAccountNames = {
      ...defaultProps,
      accounts: [],
    };

    render(<TransactionDetails {...propsWithoutAccountNames} />);

    expect(screen.getByText('To **** 4321')).toBeInTheDocument();
    expect(screen.getByText('From: **** 7890')).toBeInTheDocument();
  });

  it('should display payment number as transaction ID', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Payment number')).toBeInTheDocument();
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });
});
