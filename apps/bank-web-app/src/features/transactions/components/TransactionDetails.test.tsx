import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionDetails } from './TransactionDetails';
import { ActivityDetail } from '../hooks/useActivityDetail';

vi.mock('../../../lib/formatCurrency', () => ({
  formatCurrency: vi.fn((amount: number) => `$${(amount / 100).toFixed(2)}`),
}));

vi.mock('../../../lib/formatAccountNumber', () => ({
  formatAccountNumber: vi.fn((number: string) => {
    if (!number) return '****';
    return `**** ${number.slice(-4)}`;
  }),
}));

const mockTransaction: Extract<ActivityDetail, { kind: 'POSTED_TRANSACTION' }> =
  {
    kind: 'POSTED_TRANSACTION',
    activityId: 'TXN#txn-123',
    transactionId: 'txn-123',
    amountMinor: 1000,
    description: 'Test transaction description',
    postedAt: '2024-01-01T00:00:00.000Z',
    originHoldId: undefined,
    side: 'DEBIT',
    type: 'TRANSFER',
    status: 'POSTED',
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
    expect(screen.getByText('Operation')).toBeInTheDocument();
    expect(screen.getAllByText('01/01/2024')).toHaveLength(2);
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });

  it('should render transaction details for incoming transfer', () => {
    const incomingTransaction: Extract<
      ActivityDetail,
      { kind: 'POSTED_TRANSACTION' }
    > = {
      ...mockTransaction,
      side: 'CREDIT',
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

    expect(screen.getByText('From account')).toBeInTheDocument();
    expect(screen.getByText('To account')).toBeInTheDocument();
    expect(
      screen.getByText('**** 7890 (Test Account 1)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('**** 4321 (Test Account 2)')
    ).toBeInTheDocument();
  });

  it('should display correct account information for incoming transfer with names', () => {
    const incomingTransaction: Extract<
      ActivityDetail,
      { kind: 'POSTED_TRANSACTION' }
    > = {
      ...mockTransaction,
      side: 'CREDIT',
      counterpartyAccountNumber: '1234567890',
    };

    const props = {
      ...defaultProps,
      currentAccountId: 'acc-456',
      currentAccountNumber: '0987654321',
    };

    render(<TransactionDetails {...props} transaction={incomingTransaction} />);

    expect(screen.getByText('From account')).toBeInTheDocument();
    expect(screen.getByText('To account')).toBeInTheDocument();
    expect(
      screen.getByText('**** 7890 (Test Account 1)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('**** 4321 (Test Account 2)')
    ).toBeInTheDocument();
  });

  it('should display transaction status correctly', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('should display completed status correctly', () => {
    const completedTransaction: Extract<
      ActivityDetail,
      { kind: 'POSTED_TRANSACTION' }
    > = {
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
    const transactionWithoutDescription: Extract<
      ActivityDetail,
      { kind: 'POSTED_TRANSACTION' }
    > = {
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

    expect(screen.getByText('**** 4321')).toBeInTheDocument();
    expect(screen.getByText('**** 7890')).toBeInTheDocument();
  });

  it('should display payment number as transaction ID', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Payment number')).toBeInTheDocument();
    expect(screen.getByText('txn-123')).toBeInTheDocument();
  });

  it('should render card purchase details when card metadata is present', () => {
    const cardTransaction: Extract<
      ActivityDetail,
      { kind: 'POSTED_TRANSACTION' }
    > = {
      ...mockTransaction,
      cardLast4: '4242',
      merchantName: 'Demo Shop',
      processorChargeId: 'ch_123',
      originHoldId: 'hold-123',
    };

    render(
      <TransactionDetails {...defaultProps} transaction={cardTransaction} />
    );

    expect(
      screen.getByRole('heading', { name: 'Card purchase' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('**** 4242')).toHaveLength(2);
    expect(screen.getByText('Demo Shop')).toBeInTheDocument();
    expect(screen.getByText('ch_123')).toBeInTheDocument();
    expect(screen.getByText('hold-123')).toBeInTheDocument();
  });

  it('should show empty related contracts state by default', () => {
    render(<TransactionDetails {...defaultProps} />);

    expect(screen.getByText('Linked contracts')).toBeInTheDocument();
    expect(screen.getByText('No related contracts found.')).toBeInTheDocument();
  });

  it('should render related contracts list when provided', () => {
    render(
      <TransactionDetails
        {...defaultProps}
        relatedContracts={[
          {
            contractId: 'contract-1',
            typeBlueId: 'type-1',
            displayName: 'PayNote Voucher',
            sessionId: 'session-1',
            status: 'accepted',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T12:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getAllByText('PayNote Voucher')).toHaveLength(2);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(
      screen.queryByText('No related contracts found.')
    ).not.toBeInTheDocument();
  });

  it('should render related proposal when provided', () => {
    render(
      <TransactionDetails
        {...defaultProps}
        relatedContracts={[
          {
            kind: 'proposal',
            deliveryId: 'delivery-1',
            deliverySessionId: 'session-delivery-1',
            name: 'Slow Digestion PayNote',
            amountMinor: 1200,
            currency: 'USD',
            clientDecisionStatus: 'pending',
            transactionId: 'txn-123',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText('Slow Digestion PayNote')).toBeInTheDocument();
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('should hide proposal when matching contract exists', () => {
    render(
      <TransactionDetails
        {...defaultProps}
        relatedContracts={[
          {
            contractId: 'contract-1',
            typeBlueId: 'type-1',
            displayName: 'PayNote',
            sessionId: 'session-1',
            status: 'accepted',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T12:00:00.000Z',
          },
          {
            kind: 'proposal',
            deliveryId: 'delivery-1',
            deliverySessionId: 'delivery-session-1',
            payNoteSessionIds: ['session-1'],
            name: 'Slow Digestion PayNote',
            amountMinor: 1200,
            currency: 'USD',
            clientDecisionStatus: 'accepted',
            transactionId: 'txn-123',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getAllByText('PayNote').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Slow Digestion PayNote')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Proposal')).not.toBeInTheDocument();
  });
});
