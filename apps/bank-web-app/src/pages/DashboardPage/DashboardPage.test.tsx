import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { DashboardPage } from './index';
import { createTestWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCreateAccount } from '../../features/accounts/hooks/useCreateAccount';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock the hooks and components
vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/accounts/hooks/useAccounts', () => ({
  useAccounts: vi.fn(),
}));

vi.mock('../../features/accounts/hooks/useCreateAccount', () => ({
  useCreateAccount: vi.fn(),
}));

vi.mock('../../features/transfer', () => ({
  TransferModal: vi.fn(({ isOpen, onClose, accounts, defaultAccountId }) =>
    isOpen ? (
      <div data-testid="transfer-modal">
        Transfer Modal
        <button onClick={onClose} data-testid="close-transfer-modal">
          Close
        </button>
      </div>
    ) : null
  ),
  FundModal: vi.fn(({ isOpen, onClose, accounts, defaultAccountId }) =>
    isOpen ? (
      <div data-testid="fund-modal">
        Fund Modal
        <button onClick={onClose} data-testid="close-fund-modal">
          Close
        </button>
      </div>
    ) : null
  ),
  TransactionHistory: vi.fn(() => (
    <div data-testid="transaction-history">Transaction History</div>
  )),
}));

vi.mock('../../features/dashboard/components', () => ({
  DashboardHeader: vi.fn(({ userName }) => (
    <div data-testid="dashboard-header">Dashboard Header - {userName}</div>
  )),
}));

vi.mock('../../features/accounts/components', () => ({
  HorizontalAccountsList: vi.fn(
    ({ accounts, onCreateAccount, onTransfer, isCreatingAccount }) => (
      <div data-testid="horizontal-accounts-list">
        Horizontal Accounts List - {accounts.length} accounts
        <button onClick={onCreateAccount} data-testid="create-account-btn">
          Create Account
        </button>
        <button
          onClick={() => onTransfer('test-id')}
          data-testid="transfer-btn"
        >
          Transfer
        </button>
        {isCreatingAccount && (
          <div data-testid="creating-account">Creating...</div>
        )}
      </div>
    )
  ),
  AddAccountCard: vi.fn(({ onClick, isLoading }) => (
    <div data-testid="add-account-card">
      <button onClick={onClick} data-testid="add-account-btn">
        Add Account
      </button>
      {isLoading && <div data-testid="loading">Loading...</div>}
    </div>
  )),
  AccountCreationModal: vi.fn(({ isOpen, onClose, onSuccess }) =>
    isOpen ? (
      <div data-testid="account-creation-modal">
        Account Creation Modal
        <button onClick={onClose} data-testid="close-modal">
          Close
        </button>
        <button
          onClick={() =>
            onSuccess({
              accountId: 'test-id',
              accountNumber: '1234567890',
              name: 'Test Account',
            })
          }
          data-testid="create-account-success"
        >
          Create Account
        </button>
      </div>
    ) : null
  ),
}));

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseAccounts = useAccounts as ReturnType<typeof vi.fn>;
const mockUseCreateAccount = useCreateAccount as ReturnType<typeof vi.fn>;

const mockAccounts = [
  {
    accountId: '1',
    accountNumber: '1234567890',
    name: 'Primary Account',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 100000,
    availableBalanceMinor: 100000,
    status: 'ACTIVE',
  },
  {
    accountId: '2',
    accountNumber: '9876543210',
    name: 'Savings Account',
    currency: 'USD' as const,
    createdAt: '2023-01-02T00:00:00Z',
    ledgerBalanceMinor: 250000,
    availableBalanceMinor: 250000,
    status: 'ACTIVE',
  },
];

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockUseAuth.mockReturnValue({
      user: { name: 'Alice', userId: 'user-1' },
      signOut: vi.fn(),
    });

    mockUseAccounts.mockReturnValue({
      data: mockAccounts,
      isLoading: false,
      error: null,
    });

    mockUseCreateAccount.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it('should render loading state', () => {
    mockUseAccounts.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByText('Loading your accounts...')).toBeInTheDocument();
    expect(screen.getByTestId('accounts-loading-spinner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    const container = screen
      .getByTestId('accounts-loading-spinner')
      .closest('div');
    expect(container?.parentElement).toHaveClass(
      'h-screen',
      'bg-gradient-to-br',
      'from-green-400',
      'to-yellow-400'
    );
  });

  it('should render error state', () => {
    mockUseAccounts.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network error'),
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(
      screen.getByText('Error loading accounts. Please try again.')
    ).toBeInTheDocument();

    const container = screen
      .getByText('Error loading accounts. Please try again.')
      .closest('div');
    expect(container?.parentElement).toHaveClass(
      'h-screen',
      'bg-gradient-to-br',
      'from-green-400',
      'to-yellow-400'
    );
  });

  it('should render dashboard header with user name', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Header - Alice')).toBeInTheDocument();
  });

  it('should render horizontal accounts list when accounts exist', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('horizontal-accounts-list')).toBeInTheDocument();
    expect(
      screen.getByText('Horizontal Accounts List - 2 accounts')
    ).toBeInTheDocument();
  });

  it('should render transaction history when accounts exist', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('transaction-history')).toBeInTheDocument();
  });

  it('should render empty state when no accounts exist', () => {
    mockUseAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('horizontal-accounts-list')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history')).toBeInTheDocument();
  });

  it('should handle create account action', () => {
    const mockMutate = vi.fn();
    mockUseCreateAccount.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByTestId('create-account-btn'));

    expect(screen.getByTestId('account-creation-modal')).toBeInTheDocument();
  });

  it('should show loading state when creating account', () => {
    mockUseCreateAccount.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByTestId('create-account-btn'));

    expect(screen.getByTestId('account-creation-modal')).toBeInTheDocument();
  });

  it('should handle transfer action', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByTestId('transfer-btn'));

    expect(mockNavigate).toHaveBeenCalledWith(
      '/transfer/new?accountId=test-id'
    );
  });

  it('should handle guest user name', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      signOut: vi.fn(),
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByText('Dashboard Header - Guest')).toBeInTheDocument();
  });

  it('should have green gradient background', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    const mainContainer = screen.getByTestId('dashboard-main-container');
    expect(mainContainer).toHaveClass('h-screen');
    expect(mainContainer).toHaveClass('bg-gradient-to-br');
    expect(mainContainer).toHaveClass('from-green-400');
    expect(mainContainer).toHaveClass('to-yellow-400');
    expect(mainContainer).toHaveClass('overflow-hidden');
  });
});
