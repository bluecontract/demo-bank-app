import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TransactionHistory } from './TransactionHistory';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useActivity } from '../../transactions/hooks/useActivity';
import { useAccounts } from '../../accounts/hooks/useAccounts';

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

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
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

  it('should show transaction history header even when no account is selected', () => {
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

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.queryByText('Account:')).not.toBeInTheDocument();
    expect(screen.getByTestId('transaction-history-list')).toHaveTextContent(
      /Empty:\s*true[\s\S]*Count:\s*0/
    );
  });

  it('should show transaction history header with account number when account is selected', () => {
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

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.getByText('Account:')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
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

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
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

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
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

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
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

    const cardElement = container.querySelector(
      '.p-8.flex.flex-col.flex-1.min-h-0'
    );
    expect(cardElement).toBeInTheDocument();
  });
});
