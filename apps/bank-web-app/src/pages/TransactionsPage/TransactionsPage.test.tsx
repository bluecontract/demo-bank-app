import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionsPage } from './index';
import { createTestWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCards } from '../../features/cards/hooks/useCards';
import { TransactionHistory } from '../../features/transfer';

vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/accounts/hooks/useAccounts', () => ({
  useAccounts: vi.fn(),
}));

vi.mock('../../features/cards/hooks/useCards', () => ({
  useCards: vi.fn(),
}));

vi.mock('../../features/transfer', () => ({
  TransactionHistory: vi.fn(({ cardId }) => (
    <div data-testid="transaction-history">{cardId ?? 'all'}</div>
  )),
}));

vi.mock('../../features/dashboard/components', () => ({
  DashboardShell: vi.fn(({ header, children, 'data-testid': testId }) => (
    <div data-testid={testId || 'dashboard-shell'}>
      {header}
      {children}
    </div>
  )),
}));

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseAccounts = useAccounts as ReturnType<typeof vi.fn>;
const mockUseCards = useCards as ReturnType<typeof vi.fn>;
const mockTransactionHistory = TransactionHistory as ReturnType<typeof vi.fn>;

const mockAccounts = [
  {
    accountId: 'account-1',
    accountNumber: '1234567890',
    name: 'Primary Account',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    accountType: 'DEPOSIT' as const,
    creditLimitMinor: undefined,
    ledgerBalanceMinor: 100000,
    availableBalanceMinor: 100000,
    status: 'ACTIVE',
  },
  {
    accountId: 'account-2',
    accountNumber: '9876543210',
    name: 'Savings Account',
    currency: 'USD' as const,
    createdAt: '2023-01-02T00:00:00Z',
    accountType: 'DEPOSIT' as const,
    creditLimitMinor: undefined,
    ledgerBalanceMinor: 250000,
    availableBalanceMinor: 250000,
    status: 'ACTIVE',
  },
];

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: { email: 'alice@example.com', userId: 'user-1' },
      signOut: vi.fn(),
    });

    mockUseAccounts.mockReturnValue({
      data: mockAccounts,
      isLoading: false,
      error: null,
    });

    mockUseCards.mockReturnValue({
      data: [
        { cardId: 'card-1', panLast4: '1234', status: 'ACTIVE' },
        { cardId: 'card-2', panLast4: '5678', status: 'ACTIVE' },
      ],
      isLoading: false,
      isError: false,
    });
  });

  it('renders loading state', () => {
    mockUseAccounts.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    render(<TransactionsPage />, { wrapper: createTestWrapper() });

    expect(screen.getByText('Loading your accounts...')).toBeInTheDocument();
    expect(screen.getByTestId('accounts-loading-spinner')).toBeInTheDocument();
  });

  it('renders error state', () => {
    mockUseAccounts.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network error'),
    });

    render(<TransactionsPage />, { wrapper: createTestWrapper() });

    expect(
      screen.getByText('Error loading accounts. Please try again.')
    ).toBeInTheDocument();
  });

  it('renders filters and forwards card selection to TransactionHistory', async () => {
    render(<TransactionsPage />, { wrapper: createTestWrapper() });

    const accountSelect = await screen.findByLabelText('Select account');
    const cardSelect = screen.getByLabelText('Select card');

    expect(accountSelect).toBeInTheDocument();
    expect(cardSelect).toBeInTheDocument();
    expect(screen.getByText('All cards')).toBeInTheDocument();

    // Auto-selects the first account and renders the shared TransactionHistory panel.
    expect(mockTransactionHistory).toHaveBeenCalled();
    expect(screen.getByTestId('transaction-history')).toHaveTextContent('all');

    fireEvent.click(cardSelect);
    fireEvent.click(screen.getByRole('option', { name: '**** 5678' }));
    expect(screen.getByTestId('transaction-history')).toHaveTextContent(
      'card-2'
    );
  });
});
