import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionDetailsModal } from './TransactionDetailsModal';
import { ActivityItem } from '../hooks/useActivity';

const useActivityDetailMock = vi.hoisted(() => vi.fn());
const useAccountsMock = vi.hoisted(() => vi.fn());
const useTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useActivityDetail', () => ({
  useActivityDetail: useActivityDetailMock,
}));

vi.mock('../hooks/useTransaction', () => ({
  useTransaction: useTransactionMock,
}));

vi.mock('../../accounts/hooks/useAccounts', () => ({
  useAccounts: useAccountsMock,
}));

describe('TransactionDetailsModal', () => {
  const transactionActivity: ActivityItem = {
    kind: 'POSTED_TRANSACTION',
    activityId: 'TXN#txn-1',
    transactionId: 'txn-1',
    amountMinor: 1200,
    description: 'Test',
    postedAt: '2024-01-01T00:00:00.000Z',
    originHoldId: undefined,
    side: 'CREDIT',
    type: 'FUNDING',
    status: 'POSTED',
    counterpartyAccountNumber: '0987654321',
  };

  const holdActivity: ActivityItem = {
    kind: 'HOLD_CREATED',
    activityId: 'HOLD#hold-1',
    holdId: 'hold-1',
    amountMinor: 5000,
    description: 'Authorization',
    createdAt: '2024-01-02T00:00:00.000Z',
    counterpartyAccountNumber: '1234567890',
    createdByUserId: 'user-1',
    idempotencyKeyHash: 'hash',
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    accountId: 'acc-1',
    accountNumber: '1234567890',
    activityId: 'TXN#txn-1',
    selectedActivity: transactionActivity,
    currentAccountNumber: '1234567890',
    accounts: [],
  };

  beforeEach(() => {
    useAccountsMock.mockReturnValue({
      data: [],
      isLoading: false,
    });
    useActivityDetailMock.mockReset();
    useTransactionMock.mockReset();
    defaultProps.onClose.mockClear();
    useTransactionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: undefined,
    });
  });

  it('renders transaction details when activity is a posted transaction', () => {
    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'CREDIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
      },
      isLoading: false,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    expect(screen.getByText('Payment number')).toBeInTheDocument();
    expect(screen.getByText('txn-1')).toBeInTheDocument();
  });

  it('falls back to transaction details query when activity detail is missing', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Primary fetch failed'),
    });

    useTransactionMock.mockReturnValue({
      data: {
        txnId: 'txn-1',
        accountId: 'acc-1',
        side: 'CREDIT',
        amountMinor: 1200,
        type: 'FUNDING',
        status: 'POSTED',
        timestamp: '2024-01-01T00:00:00.000Z',
        description: 'Fallback transaction',
        counterpartyAccountNumber: '0987654321',
      },
      isLoading: false,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    expect(screen.getByText('Fallback transaction')).toBeInTheDocument();
  });

  it('renders hold details when activity is a hold', () => {
    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'HOLD',
        activityId: 'HOLD#hold-1',
        holdId: 'hold-1',
        amountMinor: 5000,
        currency: 'USD',
        status: 'PENDING',
        description: 'Authorization',
        createdAt: '2024-01-02T00:00:00.000Z',
        timeline: [
          {
            type: 'CREATED',
            at: '2024-01-02T00:00:00.000Z',
            createdByUserId: 'user-1',
            idempotencyKeyHash: 'hash',
          },
        ],
        payNote: null,
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        activityId="HOLD#hold-1"
        selectedActivity={holdActivity}
      />
    );

    expect(screen.getByText('Hold Details')).toBeInTheDocument();
    expect(screen.getByText('Hold overview')).toBeInTheDocument();
    expect(screen.getByText('hold-1')).toBeInTheDocument();
    expect(screen.getByText('From account')).toBeInTheDocument();
    expect(screen.getByText('To account')).toBeInTheDocument();
    expect(screen.getByText('Hold placed')).toBeInTheDocument();
  });

  it('displays loading state while fetching activity detail', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading activity details...')).toBeInTheDocument();
  });

  it('displays error state when detail fetch fails', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Test failure'),
    });

    useTransactionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Fallback failure'),
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByTestId('activity-error')).toBeInTheDocument();
    expect(screen.getByText('Activity Not Found')).toBeInTheDocument();
    expect(screen.getByText('Fallback failure')).toBeInTheDocument();
  });
});
