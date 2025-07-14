import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TransactionHistory } from './TransactionHistory';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useTransactions } from '../../transactions/hooks/useTransactions';
import { useAccounts } from '../../accounts/hooks/useAccounts';

vi.mock('../../../app/providers/SelectedAccountProvider', () => ({
  useSelectedAccount: vi.fn(),
}));

vi.mock('../../transactions/hooks/useTransactions', () => ({
  useTransactions: vi.fn(),
}));

vi.mock('../../accounts/hooks/useAccounts', () => ({
  useAccounts: vi.fn(),
}));

vi.mock('../../transactions/components/TransactionList', () => ({
  TransactionList: ({
    transactions,
    isLoading,
    isError,
    isEmpty,
    'data-testid': testId,
  }: {
    transactions: any[];
    isLoading: boolean;
    isError: boolean;
    isEmpty: boolean;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId}>
      Mock TransactionList - Loading: {isLoading.toString()} - Error:{' '}
      {isError.toString()} - Empty: {isEmpty.toString()} - Count:{' '}
      {transactions.length}
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

const mockTransactions = [
  {
    txnId: 'txn-123',
    accountId: 'test-account-id',
    side: 'CREDIT' as const,
    amountMinor: 100000,
    type: 'FUNDING',
    status: 'COMPLETED',
    timestamp: '2023-01-15T10:30:00Z',
    description: 'Test deposit',
    counterpartyAccountNumber: '1234567890',
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

    (useTransactions as any).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.queryByText('Account:')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: false - Empty: true - Count: 0'
      )
    ).toBeInTheDocument();
  });

  it('should show transaction history header with account number when account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: mockTransactions },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.getByText('Account:')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: false - Empty: false - Count: 1'
      )
    ).toBeInTheDocument();
  });

  it('should show loading state when transactions are being fetched', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mock TransactionList - Loading: true - Error: false - Empty: false - Count: 0'
      )
    ).toBeInTheDocument();
  });

  it('should show error state when transactions fail to load', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: true - Empty: false - Count: 0'
      )
    ).toBeInTheDocument();
  });

  it('should show empty state when account is selected but no transactions exist', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: false - Empty: true - Count: 0'
      )
    ).toBeInTheDocument();
  });

  it('should pass correct accountId to useTransactions hook', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(useTransactions).toHaveBeenCalledWith({
      accountId: 'test-account-id',
    });
  });

  it('should pass null accountId when no account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: null,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(useTransactions).toHaveBeenCalledWith({
      accountId: null,
    });
  });

  it('should handle transactions data correctly', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: mockTransactions },
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: false - Empty: false - Count: 1'
      )
    ).toBeInTheDocument();
  });

  it('should handle undefined transactions data', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    renderWithRouter(<TransactionHistory />);

    expect(
      screen.getByText(
        'Mock TransactionList - Loading: false - Error: false - Empty: true - Count: 0'
      )
    ).toBeInTheDocument();
  });

  it('should have proper Card styling', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    (useTransactions as any).mockReturnValue({
      data: { items: [] },
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
