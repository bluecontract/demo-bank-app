import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { TransactionList } from './TransactionList';
import { ActivityItem } from '../hooks/useActivity';

const onTransactionClickSpy = vi.fn();

vi.mock('./TransactionItem', () => ({
  TransactionItem: ({
    item,
    onTransactionClick,
    'data-testid': testId,
  }: {
    item: ActivityItem;
    onTransactionClick: (txnId: string) => void;
    'data-testid'?: string;
  }) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        onTransactionClick(
          item.kind === 'POSTED_TRANSACTION' ? item.transactionId : 'noop'
        );
        onTransactionClickSpy(
          item.kind === 'POSTED_TRANSACTION' ? item.transactionId : 'noop'
        );
      }}
    >
      Mock Activity Item - {item.kind}
    </button>
  ),
}));

const modalSpy = vi.fn();

vi.mock('./TransactionDetailsModal', () => ({
  TransactionDetailsModal: (props: any) => {
    modalSpy(props);
    if (!props.isOpen) {
      return null;
    }
    return (
      <div data-testid="transaction-modal">
        Mock Transaction Modal - {props.txnId}
      </div>
    );
  },
}));

const postedTransaction: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  transactionId: 'txn-123',
  amountMinor: 100000,
  description: 'Deposit',
  postedAt: '2023-01-01T00:00:00Z',
  originHoldId: undefined,
  side: 'CREDIT',
  type: 'FUNDING',
  status: 'POSTED',
  counterpartyAccountNumber: '1234567890',
};

const holdCreated: ActivityItem = {
  kind: 'HOLD_CREATED',
  holdId: 'hold-1',
  amountMinor: 50000,
  description: 'Pending purchase',
  createdAt: '2023-01-02T12:00:00Z',
  counterpartyAccountNumber: '5555555555',
  createdByUserId: 'tester',
  idempotencyKeyHash: 'hash',
};

describe('TransactionList', () => {
  beforeEach(() => {
    modalSpy.mockClear();
    onTransactionClickSpy.mockClear();
  });

  it('renders loading state', () => {
    render(
      <TransactionList
        activityItems={[]}
        accountId="acc-1"
        isLoading
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    expect(screen.getByText('Loading account activity...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(
      <TransactionList
        activityItems={[]}
        accountId="acc-1"
        isLoading={false}
        isError
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    expect(
      screen.getByText('Failed to load account activity')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Please try refreshing the page')
    ).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(
      <TransactionList
        activityItems={[]}
        accountId="acc-1"
        isLoading={false}
        isError={false}
        isEmpty
        data-testid="activity-list"
      />
    );

    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Account activity will appear here once you post a transaction or create a hold.'
      )
    ).toBeInTheDocument();
  });

  it('renders activity items', () => {
    render(
      <TransactionList
        activityItems={[postedTransaction, holdCreated]}
        accountId="acc-1"
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    expect(screen.getByTestId('activity-item-txn-txn-123')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-hold-hold-1')).toBeInTheDocument();
  });

  it('opens modal when posted transaction row is clicked', () => {
    render(
      <TransactionList
        activityItems={[postedTransaction]}
        accountId="acc-1"
        currentAccountNumber="1234567890"
        accounts={[]}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    fireEvent.click(screen.getByTestId('activity-item-txn-txn-123'));

    expect(onTransactionClickSpy).toHaveBeenCalledWith('txn-123');
    expect(
      screen.getByText('Mock Transaction Modal - txn-123')
    ).toBeInTheDocument();
  });
});
