import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TransactionHistory } from './TransactionHistory';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useActivity } from '../../transactions/hooks/useActivity';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import { routerFutureConfig } from '../../../app/routerFutureConfig';

vi.mock('../../../app/providers/SelectedAccountProvider', () => ({
  useSelectedAccount: vi.fn(),
}));

vi.mock('../../transactions/hooks/useActivity', () => ({
  useActivity: vi.fn(),
}));

vi.mock('../../accounts/hooks/useAccounts', () => ({
  useAccounts: vi.fn(),
}));

vi.mock('../../transactions/components/TransactionList', () => ({
  TransactionList: ({
    activityItems,
    isLoading,
    isError,
    isEmpty,
    'data-testid': testId,
  }: {
    activityItems: any[];
    isLoading: boolean;
    isError: boolean;
    isEmpty: boolean;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      Mock TransactionList - Loading: {isLoading.toString()} - Error:{' '}
      {isError.toString()} - Empty: {isEmpty.toString()} - Count:{' '}
      {activityItems.length}
    </div>
  ),
}));

const mockAccount = {
  accountId: 'test-account-id',
  accountNumber: '1234567890',
  name: 'Test Account',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  accountType: 'DEPOSIT' as const,
  creditLimitMinor: undefined,
  ledgerBalanceMinor: 100000,
  availableBalanceMinor: 100000,
  status: 'ACTIVE',
};

const mockAccounts = [mockAccount];

const mockActivity = [
  {
    kind: 'POSTED_TRANSACTION' as const,
    activityId: 'TXN#txn-123',
    transactionId: 'txn-123',
    amountMinor: 100000,
    description: 'Test deposit',
    postedAt: '2023-01-15T10:30:00Z',
    originHoldId: undefined,
    side: 'CREDIT' as const,
    type: 'FUNDING',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
  },
  {
    kind: 'HOLD_CREATED' as const,
    activityId: 'HOLD#hold-1',
    holdId: 'hold-1',
    amountMinor: 50000,
    description: 'Hold for transfer',
    createdAt: '2023-01-16T08:00:00Z',
    counterpartyAccountNumber: '0987654321',
    createdByUserId: 'tester',
    idempotencyKeyHash: 'hash',
  },
];

const mockActivityWithFilters = [
  {
    kind: 'POSTED_TRANSACTION' as const,
    activityId: 'TXN#txn-card',
    transactionId: 'txn-card',
    amountMinor: 12500,
    description: 'Card purchase',
    postedAt: '2023-02-01T10:30:00Z',
    originHoldId: undefined,
    side: 'DEBIT' as const,
    type: 'TRANSFER',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
    cardLast4: '4242',
    merchantName: 'Cafe Delta',
  },
  {
    kind: 'HOLD_CREATED' as const,
    activityId: 'HOLD#card-hold',
    holdId: 'hold-card',
    amountMinor: 2300,
    description: 'Card hold',
    createdAt: '2023-02-02T08:00:00Z',
    counterpartyAccountNumber: '0987654321',
    createdByUserId: 'tester',
    idempotencyKeyHash: 'hash-1',
    cardId: 'card-1',
    cardLast4: '4242',
    merchantName: 'Cafe Delta',
  },
  {
    kind: 'HOLD_CREATED' as const,
    activityId: 'HOLD#bank-hold',
    holdId: 'hold-bank',
    amountMinor: 50000,
    description: 'Hold for transfer',
    createdAt: '2023-02-03T08:00:00Z',
    counterpartyAccountNumber: '0987654321',
    createdByUserId: 'tester',
    idempotencyKeyHash: 'hash-2',
  },
  {
    kind: 'POSTED_TRANSACTION' as const,
    activityId: 'TXN#txn-bank',
    transactionId: 'txn-bank',
    amountMinor: 50000,
    description: 'Transfer',
    postedAt: '2023-02-04T12:30:00Z',
    originHoldId: undefined,
    side: 'CREDIT' as const,
    type: 'TRANSFER',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
  },
];

const mockCardGroupedActivity = [
  {
    kind: 'HOLD_CREATED' as const,
    activityId: 'HOLD#hold-missing-card',
    holdId: 'hold-missing-card',
    amountMinor: 4200,
    description: 'Card hold without metadata',
    createdAt: '2023-03-01T08:00:00Z',
    counterpartyAccountNumber: '0987654321',
    createdByUserId: 'tester',
    idempotencyKeyHash: 'hash-3',
  },
  {
    kind: 'HOLD_CAPTURED' as const,
    activityId: 'HOLD#hold-missing-card',
    holdId: 'hold-missing-card',
    amountMinor: 4200,
    description: 'Card capture',
    capturedAt: '2023-03-01T08:00:01Z',
    transactionId: 'txn-card-1',
    counterpartyAccountNumber: '1112223333',
    cardId: 'card-2',
    cardLast4: '1234',
    merchantName: 'Demo Shop',
    processorChargeId: 'ch_123',
  },
  {
    kind: 'POSTED_TRANSACTION' as const,
    activityId: 'TXN#txn-transfer',
    transactionId: 'txn-transfer',
    amountMinor: 50000,
    description: 'Transfer',
    postedAt: '2023-03-02T12:30:00Z',
    originHoldId: undefined,
    side: 'DEBIT' as const,
    type: 'TRANSFER',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
  },
];

const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <MemoryRouter future={routerFutureConfig}>{component}</MemoryRouter>
  );
};

describe('TransactionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAccounts as any).mockReturnValue({
      data: mockAccounts,
      isLoading: false,
      isError: false,
    });
  });

  it('should show transactions header even when no account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: null,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.queryByText('Account:')).not.toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Empty:\s*true[\s\S]*Count:\s*0/
    );
  });

  it('should show transactions header when account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: mockActivity, nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*2/
    );
  });

  it('should show loading state when transactions are being fetched', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Loading:\s*true/
    );
  });

  it('should show error state when transactions fail to load', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Error:\s*true/
    );
  });

  it('should show empty state when account is selected but no transactions exist', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Empty:\s*true[\s\S]*Count:\s*0/
    );
  });

  it('should pass correct account number to useActivity hook', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(useActivity).toHaveBeenCalledWith({
      accountNumber: '1234567890',
    });
  });

  it('should pass null account number when no account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: null,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(useActivity).toHaveBeenCalledWith({
      accountNumber: null,
    });
  });

  it('should handle activity data correctly', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: mockActivity, nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Empty:\s*false[\s\S]*Count:\s*2/
    );
  });

  it('should filter activity items by selected category', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: mockActivityWithFilters, nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*4/
    );

    fireEvent.click(screen.getByTestId('activity-filter-cards'));
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*2/
    );

    fireEvent.click(screen.getByTestId('activity-filter-holds'));
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*2/
    );

    fireEvent.click(screen.getByTestId('activity-filter-transfers'));
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*2/
    );
  });

  it('includes related hold events in cards filter even without card metadata', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: mockCardGroupedActivity, nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    fireEvent.click(screen.getByTestId('activity-filter-cards'));
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Count:\s*2/
    );
  });

  it('should handle undefined activity data', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Empty:\s*true[\s\S]*Count:\s*0/
    );
  });

  it('should have proper Card styling', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useActivity as any).mockReturnValue({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
    });

    const { container } = renderWithRouter(<TransactionHistory />);

    const cardElement = container.querySelector('.app-surface');
    expect(cardElement).toBeInTheDocument();
  });
});
