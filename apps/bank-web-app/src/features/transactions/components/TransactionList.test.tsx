import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { ActivityItem } from '../hooks/useActivity';
import { TransactionList } from './TransactionList';

const onActivitySelectSpy = vi.fn();

vi.mock('./TransactionItem', () => ({
  TransactionItem: ({
    item,
    onActivitySelect,
    'data-testid': testId,
  }: {
    item: ActivityItem;
    onActivitySelect: (activity: ActivityItem) => void;
    'data-testid'?: string;
  }) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        onActivitySelect(item);
        onActivitySelectSpy(item);
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
        Mock Transaction Modal - {props.activityId}
      </div>
    );
  },
}));

const postedTransaction: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  activityId: 'TXN#txn-123',
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
  activityId: 'HOLD#hold-1',
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
    onActivitySelectSpy.mockClear();
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

    expect(onActivitySelectSpy).toHaveBeenCalledWith(postedTransaction);
    expect(
      screen.getByText('Mock Transaction Modal - TXN#txn-123')
    ).toBeInTheDocument();
  });

  it('opens modal when hold row is clicked', () => {
    render(
      <TransactionList
        activityItems={[holdCreated]}
        accountId="acc-1"
        currentAccountNumber="1234567890"
        accounts={[]}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    fireEvent.click(screen.getByTestId('activity-item-hold-hold-1'));

    expect(onActivitySelectSpy).toHaveBeenCalledWith(holdCreated);
    expect(
      screen.getByText('Mock Transaction Modal - HOLD#hold-1')
    ).toBeInTheDocument();
  });

  it('clears selection when account context changes', () => {
    const { rerender } = render(
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
    expect(
      screen.getByText('Mock Transaction Modal - TXN#txn-123')
    ).toBeInTheDocument();

    rerender(
      <TransactionList
        activityItems={[postedTransaction]}
        accountId="acc-2"
        currentAccountNumber="1111111111"
        accounts={[]}
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    expect(screen.queryByTestId('transaction-modal')).not.toBeInTheDocument();
  });
});
