import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ActivityItem } from '../hooks/useActivity';
import { TransactionList } from './TransactionList';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: '/transactions', search: '' }),
  };
});

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
      onClick={() => onActivitySelect(item)}
    >
      Mock Activity Item - {item.kind}
    </button>
  ),
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

const holdCaptured: ActivityItem = {
  kind: 'HOLD_CAPTURED',
  activityId: 'HOLD#hold-1',
  holdId: 'hold-1',
  amountMinor: 50000,
  description: 'Captured purchase',
  capturedAt: '2023-01-02T12:05:00Z',
  transactionId: 'txn-123',
  counterpartyAccountNumber: '5555555555',
};

const postedFromHold: ActivityItem = {
  kind: 'POSTED_TRANSACTION',
  activityId: 'TXN#txn-123',
  transactionId: 'txn-123',
  amountMinor: 50000,
  description: 'Captured purchase',
  postedAt: '2023-01-02T12:06:00Z',
  originHoldId: 'hold-1',
  side: 'DEBIT',
  type: 'TRANSFER',
  status: 'POSTED',
  counterpartyAccountNumber: '5555555555',
};

describe('TransactionList', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
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
    expect(
      screen.getByTestId('activity-item-hold_created-hold-1')
    ).toBeInTheDocument();
  });

  it('navigates to posted transaction details when row is clicked', () => {
    render(
      <TransactionList
        activityItems={[postedTransaction]}
        accountId="acc-1"
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    fireEvent.click(screen.getByTestId('activity-item-txn-txn-123'));

    expect(navigateSpy).toHaveBeenCalledWith(
      '/transactions/acc-1/TXN--txn-123',
      {
        state: {
          from: '/transactions',
          selectedActivity: postedTransaction,
        },
      }
    );
  });

  it('navigates to hold details when row is clicked', () => {
    render(
      <TransactionList
        activityItems={[holdCreated]}
        accountId="acc-1"
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    fireEvent.click(screen.getByTestId('activity-item-hold_created-hold-1'));

    expect(navigateSpy).toHaveBeenCalledWith(
      '/transactions/acc-1/HOLD--hold-1',
      {
        state: {
          from: '/transactions',
          selectedActivity: holdCreated,
        },
      }
    );
  });

  it('keeps hold lifecycle history and hides posted settlement row', () => {
    render(
      <TransactionList
        activityItems={[postedFromHold, holdCaptured, holdCreated]}
        accountId="acc-1"
        isLoading={false}
        isError={false}
        isEmpty={false}
        data-testid="activity-list"
      />
    );

    expect(screen.queryByTestId('activity-item-txn-txn-123')).toBeNull();
    expect(
      screen.getByTestId('activity-item-hold_created-hold-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('activity-item-hold_captured-hold-1')
    ).toBeInTheDocument();
  });
});
