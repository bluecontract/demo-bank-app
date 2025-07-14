import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { DashboardPage } from './index';
import { createTestWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import { useAccounts } from '../../features/accounts/hooks/useAccounts';
import { useCreateAccount } from '../../features/accounts/hooks/useCreateAccount';

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

vi.mock('../../features/dashboard/components', () => ({
  DashboardHeader: vi.fn(({ userName }) => (
    <div data-testid="dashboard-header">Dashboard Header - {userName}</div>
  )),
}));

vi.mock('../../features/accounts/components', () => ({
  AccountsList: vi.fn(({ accounts, onCreateAccount }) => (
    <div data-testid="accounts-list">
      Accounts List - {accounts.length} accounts
      <button onClick={onCreateAccount} data-testid="create-account-btn">
        Create Account
      </button>
    </div>
  )),
  AddAccountCard: vi.fn(({ onClick, isLoading }) => (
    <div data-testid="add-account-card">
      <button onClick={onClick} data-testid="add-account-btn">
        Add Account
      </button>
      {isLoading && <div data-testid="loading">Loading...</div>}
    </div>
  )),
}));

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseAccounts = useAccounts as ReturnType<typeof vi.fn>;
const mockUseCreateAccount = useCreateAccount as ReturnType<typeof vi.fn>;

const mockAccounts = [
  {
    accountId: '1',
    accountNumber: '1234567890',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 100000,
    availableBalanceMinor: 100000,
    status: 'ACTIVE',
  },
  {
    accountId: '2',
    accountNumber: '9876543210',
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

    const container = screen
      .getByText('Loading your accounts...')
      .closest('div');
    expect(container?.parentElement).toHaveClass(
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

  it('should render accounts list when accounts exist', () => {
    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('accounts-list')).toBeInTheDocument();
    expect(screen.getByText('Accounts List - 2 accounts')).toBeInTheDocument();
  });

  it('should render empty state when no accounts exist', () => {
    mockUseAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(
      screen.getByText(
        'No accounts yet. Create your first account to get started!'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('add-account-card')).toBeInTheDocument();
  });

  it('should handle create account action', () => {
    const mockMutate = vi.fn();
    mockUseCreateAccount.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByTestId('create-account-btn'));

    expect(mockMutate).toHaveBeenCalledWith({ currency: 'USD' });
  });

  it('should handle create account action from empty state', () => {
    const mockMutate = vi.fn();
    mockUseCreateAccount.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });

    mockUseAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByTestId('add-account-btn'));

    expect(mockMutate).toHaveBeenCalledWith({ currency: 'USD' });
  });

  it('should show loading state in empty state when creating account', () => {
    mockUseCreateAccount.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    });

    mockUseAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<DashboardPage />, { wrapper: createTestWrapper() });

    expect(screen.getByTestId('loading')).toBeInTheDocument();
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
    expect(mainContainer).toHaveClass('min-h-screen');
    expect(mainContainer).toHaveClass('bg-gradient-to-br');
    expect(mainContainer).toHaveClass('from-green-400');
    expect(mainContainer).toHaveClass('to-yellow-400');
  });
});
