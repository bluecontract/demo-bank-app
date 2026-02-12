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

const cardTransaction: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  activityId: 'TXN#txn-999',
  transactionId: 'txn-999',
  amountMinor: 3200,
  description: 'Demo Shop',
  postedAt: '2023-01-20T11:00:00Z',
  originHoldId: 'hold-999',
  side: 'DEBIT',
  type: 'TRANSFER',
  status: 'POSTED',
  counterpartyAccountNumber: '9999999999',
  cardLast4: '4242',
  merchantName: 'Demo Shop',
  processorChargeId: 'ch_123',
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
    expect(screen.getAllByText('COMPLETED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deposit from employer').length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByText('123 456 7890').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+$1,000').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('activity-row'));
    expect(onSelect).toHaveBeenCalledWith(postedTransaction);
  });

  it('renders posted debit transaction with outgoing details', () => {
    const onSelect = vi.fn();

    render(
      <TransactionItem item={debitTransaction} onActivitySelect={onSelect} />
    );

    expect(screen.getByText('Outgoing')).toBeInTheDocument();
    expect(screen.getAllByText('098 765 4321').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$500').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('HOLD PLACED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$450').length).toBeGreaterThan(0);
    expect(screen.getAllByText('111 111 1222').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('hold-created'));
    expect(onSelect).toHaveBeenCalledWith(holdCreated);
  });

  it('renders hold captured entry with linked transaction subtitle', () => {
    render(<TransactionItem item={holdCaptured} onActivitySelect={vi.fn()} />);

    expect(screen.getByText('Hold Captured')).toBeInTheDocument();
    expect(screen.getAllByText('HOLD CAPTURED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('222 233 3344').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$95').length).toBeGreaterThan(0);
  });

  it('renders failed hold with failure messaging', () => {
    render(<TransactionItem item={holdFailed} onActivitySelect={vi.fn()} />);

    expect(screen.getByText('Hold Failed')).toBeInTheDocument();
    expect(screen.getAllByText('HOLD FAILED').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Available balance too low').length
    ).toBeGreaterThan(0);
  });

  it('renders card transactions with merchant and card context', () => {
    render(
      <TransactionItem item={cardTransaction} onActivitySelect={vi.fn()} />
    );

    expect(screen.getAllByText('Demo Shop').length).toBeGreaterThan(0);
    const cardLabels = screen.getAllByText('**** 4242');
    expect(cardLabels.length).toBeGreaterThan(0);
    expect(screen.queryByText('999 999 9999')).not.toBeInTheDocument();
  });

  it('does not render a PayNote icon when paynote metadata is present', () => {
    const payNoteTransaction: ActivityItem = {
      ...debitTransaction,
      payNote: { payNoteDocumentId: 'doc-paynote-1' },
    };

    render(
      <TransactionItem item={payNoteTransaction} onActivitySelect={vi.fn()} />
    );

    expect(screen.queryByLabelText('PayNote')).not.toBeInTheDocument();
  });
});
