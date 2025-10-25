import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { TransactionItem } from './TransactionItem';
import { ActivityItem } from '../hooks/useActivity';

const postedTransaction: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  activityId: 'TXN#txn-123',
  transactionId: 'txn-123',
  amountMinor: 100000,
  description: 'Deposit from employer',
  postedAt: '2023-01-15T10:30:00Z',
  originHoldId: undefined,
  side: 'CREDIT',
  type: 'FUNDING',
  status: 'POSTED',
  counterpartyAccountNumber: '1234567890',
};

const debitTransaction: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  activityId: 'TXN#txn-456',
  transactionId: 'txn-456',
  amountMinor: 50000,
  description: 'Bill payment',
  postedAt: '2023-01-16T14:45:00Z',
  originHoldId: undefined,
  side: 'DEBIT',
  type: 'TRANSFER',
  status: 'POSTED',
  counterpartyAccountNumber: '0987654321',
};

const holdCreated: ActivityItem = {
  kind: 'HOLD_CREATED',
  activityId: 'HOLD#hold-1',
  holdId: 'hold-1',
  amountMinor: 45000,
  description: 'Coffee shop authorization',
  createdAt: '2023-01-17T08:00:00Z',
  counterpartyAccountNumber: '1111111222',
  createdByUserId: 'system-test',
  idempotencyKeyHash: 'hash',
};

const holdCaptured: ActivityItem = {
  kind: 'HOLD_CAPTURED',
  activityId: 'HOLD#hold-2',
  holdId: 'hold-2',
  amountMinor: 9500,
  description: 'Fuel purchase',
  capturedAt: '2023-01-18T12:30:00Z',
  transactionId: 'txn-789',
  counterpartyAccountNumber: '2222333344',
};

const holdFailed: ActivityItem = {
  kind: 'HOLD_FAILED',
  activityId: 'HOLD#hold-3',
  holdId: 'hold-3',
  amountMinor: 2500,
  description: 'Online order',
  failedAt: '2023-01-19T09:15:00Z',
  failureCode: 'INSUFFICIENT_FUNDS',
  failureMessage: 'Available balance too low',
};

describe('TransactionItem', () => {
  it('renders posted credit transaction with details and click handler', () => {
    const onSelect = vi.fn();

    render(
      <TransactionItem
        item={postedTransaction}
        onActivitySelect={onSelect}
        data-testid="activity-row"
      />
    );

    expect(screen.getByText('Incoming')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Deposit from employer')).toBeInTheDocument();
    expect(screen.getByText('From: 123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('+$1,000')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('activity-row'));
    expect(onSelect).toHaveBeenCalledWith(postedTransaction);
  });

  it('renders posted debit transaction with outgoing details', () => {
    const onSelect = vi.fn();

    render(
      <TransactionItem item={debitTransaction} onActivitySelect={onSelect} />
    );

    expect(screen.getByText('Outgoing')).toBeInTheDocument();
    expect(screen.getByText('To: 098 765 4321')).toBeInTheDocument();
    expect(screen.getByText('-$500')).toBeInTheDocument();
  });

  it('renders hold created entry and triggers click handler', () => {
    const onSelect = vi.fn();

    render(
      <TransactionItem
        item={holdCreated}
        onActivitySelect={onSelect}
        data-testid="hold-created"
      />
    );

    expect(screen.getByText('Hold Created')).toBeInTheDocument();
    expect(screen.getByText('HOLD PLACED')).toBeInTheDocument();
    expect(screen.getByText('$450')).toBeInTheDocument();
    expect(screen.getByText('To: 111 111 1222')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hold-created'));
    expect(onSelect).toHaveBeenCalledWith(holdCreated);
  });

  it('renders hold captured entry with linked transaction subtitle', () => {
    render(<TransactionItem item={holdCaptured} onActivitySelect={vi.fn()} />);

    expect(screen.getByText('Hold Captured')).toBeInTheDocument();
    expect(screen.getByText('HOLD CAPTURED')).toBeInTheDocument();
    expect(screen.getByText('To: 222 233 3344')).toBeInTheDocument();
    expect(screen.getByText('Captured txn: txn-789')).toBeInTheDocument();
    expect(screen.getByText('$95')).toBeInTheDocument();
  });

  it('renders failed hold with failure messaging', () => {
    render(<TransactionItem item={holdFailed} onActivitySelect={vi.fn()} />);

    expect(screen.getByText('Hold Failed')).toBeInTheDocument();
    expect(screen.getByText('HOLD FAILED')).toBeInTheDocument();
    expect(screen.getByText('Failure: INSUFFICIENT_FUNDS')).toBeInTheDocument();
    expect(screen.getByText('Available balance too low')).toBeInTheDocument();
  });
});
