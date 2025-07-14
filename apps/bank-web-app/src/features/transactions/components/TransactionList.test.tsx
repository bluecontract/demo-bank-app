import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { TransactionList } from './TransactionList';
import { Transaction } from '../hooks/useTransactions';

// Mock the TransactionItem component
vi.mock('./TransactionItem', () => ({
  TransactionItem: ({
    transaction,
    'data-testid': testId,
  }: {
    transaction: Transaction;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      Mock TransactionItem - {transaction.type} - {transaction.amountMinor}
    </div>
  ),
}));

const mockTransactions: Transaction[] = [
  {
    txnId: 'txn-123',
    accountId: 'acc-456',
    side: 'CREDIT',
    amountMinor: 100000,
    type: 'FUNDING',
    status: 'COMPLETED',
    timestamp: '2023-01-15T10:30:00Z',
    description: 'Test deposit',
    counterpartyAccountNumber: '1234567890',
  },
  {
    txnId: 'txn-124',
    accountId: 'acc-456',
    side: 'DEBIT',
    amountMinor: 50000,
    type: 'TRANSFER',
    status: 'COMPLETED',
    timestamp: '2023-01-16T14:45:00Z',
    description: 'Test transfer',
    counterpartyAccountNumber: '0987654321',
  },
];

describe('TransactionList', () => {
  it('should render loading state', () => {
    render(
      <TransactionList
        transactions={[]}
        isLoading={true}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('Loading transactions...')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
  });

  it('should render error state', () => {
    render(
      <TransactionList
        transactions={[]}
        isLoading={false}
        isError={true}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('Failed to load transactions')).toBeInTheDocument();
    expect(
      screen.getByText('Please try refreshing the page')
    ).toBeInTheDocument();
    expect(screen.getByText('⚠️')).toBeInTheDocument();
  });

  it('should render empty state', () => {
    render(
      <TransactionList
        transactions={[]}
        isLoading={false}
        isError={false}
        isEmpty={true}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your transaction history will appear here once you make your first transfer'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('📋')).toBeInTheDocument();
  });

  it('should render transactions list', () => {
    render(
      <TransactionList
        transactions={mockTransactions}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    expect(
      screen.getByText('Mock TransactionItem - FUNDING - 100000')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Mock TransactionItem - TRANSFER - 50000')
    ).toBeInTheDocument();
    expect(screen.getByTestId('transaction-item-txn-123')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-item-txn-124')).toBeInTheDocument();
  });

  it('should render single transaction', () => {
    const singleTransaction = [mockTransactions[0]];

    render(
      <TransactionList
        transactions={singleTransaction}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    expect(
      screen.getByText('Mock TransactionItem - FUNDING - 100000')
    ).toBeInTheDocument();
    expect(screen.getByTestId('transaction-item-txn-123')).toBeInTheDocument();
  });

  it('should have scrollable container', () => {
    render(
      <TransactionList
        transactions={mockTransactions}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    const scrollableContainer = screen
      .getByTestId('transaction-list')
      .querySelector('.overflow-y-auto');
    expect(scrollableContainer).toBeInTheDocument();
  });

  it('should have proper styling classes', () => {
    render(
      <TransactionList
        transactions={mockTransactions}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    const container = screen.getByTestId('transaction-list');
    expect(container).toHaveClass('flex-1', 'flex', 'flex-col', 'min-h-0');

    const innerContainer = container.querySelector('.overflow-y-auto');
    expect(innerContainer).toHaveClass(
      'flex-1',
      'overflow-y-auto',
      'bg-white',
      'rounded-lg',
      'border',
      'border-gray-200'
    );
  });

  it('should handle empty transactions array correctly', () => {
    render(
      <TransactionList
        transactions={[]}
        isLoading={false}
        isError={false}
        isEmpty={true}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(screen.queryByText('Mock TransactionItem')).not.toBeInTheDocument();
  });

  it('should render many transactions', () => {
    const manyTransactions = Array.from({ length: 10 }, (_, i) => ({
      ...mockTransactions[0],
      txnId: `txn-${i}`,
      amountMinor: 10000 * (i + 1),
    }));

    render(
      <TransactionList
        transactions={manyTransactions}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="transaction-list"
      />
    );

    manyTransactions.forEach((_, i) => {
      expect(
        screen.getByTestId(`transaction-item-txn-${i}`)
      ).toBeInTheDocument();
    });
  });

  it('should prioritize loading state over other states', () => {
    render(
      <TransactionList
        transactions={mockTransactions}
        isLoading={true}
        isError={true}
        isEmpty={true}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('Loading transactions...')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load transactions')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
  });

  it('should prioritize error state over empty state', () => {
    render(
      <TransactionList
        transactions={[]}
        isLoading={false}
        isError={true}
        isEmpty={true}
        data-testid="transaction-list"
      />
    );

    expect(screen.getByText('Failed to load transactions')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
  });
});
