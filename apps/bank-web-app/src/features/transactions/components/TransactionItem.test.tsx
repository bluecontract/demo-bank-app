import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { TransactionItem } from './TransactionItem';
import { Transaction } from '../hooks/useTransactions';

const mockCreditTransaction: Transaction = {
  txnId: 'txn-123',
  accountId: 'acc-456',
  side: 'CREDIT',
  amountMinor: 100000,
  type: 'FUNDING',
  status: 'COMPLETED',
  timestamp: '2023-01-15T10:30:00Z',
  description: 'Test deposit',
  counterpartyAccountNumber: '1234567890',
};

const mockDebitTransaction: Transaction = {
  txnId: 'txn-124',
  accountId: 'acc-456',
  side: 'DEBIT',
  amountMinor: 50000,
  type: 'TRANSFER',
  status: 'COMPLETED',
  timestamp: '2023-01-16T14:45:00Z',
  description: 'Test transfer',
  counterpartyAccountNumber: '0987654321',
};

const mockAccountId = 'test-account-id';
const mockOnTransactionClick = vi.fn();

describe('TransactionItem', () => {
  it('should render credit transaction correctly', () => {
    render(
      <TransactionItem
        transaction={mockCreditTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    expect(screen.getByText('Incoming')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Test deposit')).toBeInTheDocument();
    expect(screen.getByText('From: 123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('+$1,000')).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2023, 11:30 AM')).toBeInTheDocument();
  });

  it('should render debit transaction correctly', () => {
    render(
      <TransactionItem
        transaction={mockDebitTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    expect(screen.getByText('Outgoing')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Test transfer')).toBeInTheDocument();
    expect(screen.getByText('To: 098 765 4321')).toBeInTheDocument();
    expect(screen.getByText('-$500')).toBeInTheDocument();
    expect(screen.getByText('Jan 16, 2023, 03:45 PM')).toBeInTheDocument();
  });

  it('should render without description', () => {
    const transactionWithoutDescription = {
      ...mockCreditTransaction,
      description: undefined,
    };

    render(
      <TransactionItem
        transaction={transactionWithoutDescription}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    expect(screen.getByText('Incoming')).toBeInTheDocument();
    expect(screen.queryByText('Test deposit')).not.toBeInTheDocument();
  });

  it('should show correct icon for credit transaction', () => {
    render(
      <TransactionItem
        transaction={mockCreditTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    const iconContainer = screen.getByText('↓').closest('div');
    expect(iconContainer).toHaveClass('bg-green-100');
  });

  it('should show correct icon for debit transaction', () => {
    render(
      <TransactionItem
        transaction={mockDebitTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    const iconContainer = screen.getByText('↑').closest('div');
    expect(iconContainer).toHaveClass('bg-red-100');
  });

  it('should render pending status correctly', () => {
    const pendingTransaction = {
      ...mockCreditTransaction,
      status: 'PENDING',
    };

    render(
      <TransactionItem
        transaction={pendingTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    const statusElement = screen.getByText('PENDING');
    expect(statusElement).toBeInTheDocument();
    expect(statusElement).toHaveClass('bg-yellow-100', 'text-yellow-800');
  });

  it('should render completed status correctly', () => {
    render(
      <TransactionItem
        transaction={mockCreditTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );

    const statusElement = screen.getByText('COMPLETED');
    expect(statusElement).toBeInTheDocument();
    expect(statusElement).toHaveClass('bg-green-100', 'text-green-800');
  });

  it('should handle different transaction types', () => {
    const withdrawalTransaction = {
      ...mockDebitTransaction,
      type: 'WITHDRAWAL',
    };

    render(
      <TransactionItem
        transaction={withdrawalTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );
    expect(screen.getByText('Withdrawal')).toBeInTheDocument();
  });

  it('should handle unknown transaction types', () => {
    const unknownTransaction = {
      ...mockCreditTransaction,
      type: 'UNKNOWN_TYPE',
    };

    render(
      <TransactionItem
        transaction={unknownTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );
    expect(screen.getByText('UNKNOWN_TYPE')).toBeInTheDocument();
  });

  it('should format amounts correctly', () => {
    const largeAmountTransaction = {
      ...mockCreditTransaction,
      amountMinor: 123456789, // $1,234,567.89
    };

    render(
      <TransactionItem
        transaction={largeAmountTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );
    expect(screen.getByText('+$1,234,567.89')).toBeInTheDocument();
  });

  it('should format small amounts correctly', () => {
    const smallAmountTransaction = {
      ...mockCreditTransaction,
      amountMinor: 1, // $0.01
    };

    render(
      <TransactionItem
        transaction={smallAmountTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
      />
    );
    expect(screen.getByText('+$0.01')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(
      <TransactionItem
        transaction={mockCreditTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
        data-testid="transaction-item"
      />
    );

    const transactionItem = screen.getByTestId('transaction-item');
    expect(transactionItem).toBeInTheDocument();
  });

  it('should handle hover states', () => {
    render(
      <TransactionItem
        transaction={mockCreditTransaction}
        accountId={mockAccountId}
        onTransactionClick={mockOnTransactionClick}
        data-testid="transaction-item"
      />
    );

    // The hover class is on the outermost div that contains the entire transaction item
    const container = screen.getByTestId('transaction-item');
    expect(container).toHaveClass('hover:bg-gray-50');
  });
});
