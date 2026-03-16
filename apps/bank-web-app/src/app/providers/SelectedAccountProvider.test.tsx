import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import {
  SelectedAccountProvider,
  useSelectedAccount,
} from './SelectedAccountProvider';

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

// Mock the AuthProvider
const mockUseAuth = vi.fn();
vi.mock('./AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

const TestComponent = () => {
  const { selectedAccount, setSelectedAccount } = useSelectedAccount();

  return (
    <div>
      <div data-testid="selected-account">
        {selectedAccount
          ? `Selected: ${selectedAccount.accountNumber}`
          : 'No Account Selected'}
      </div>
      <button onClick={() => setSelectedAccount(mockAccount)}>
        Select Account
      </button>
      <button onClick={() => setSelectedAccount(null)}>Clear Selection</button>
    </div>
  );
};

describe('SelectedAccountProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { userId: 'user-1', name: 'Test User' },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('should start with no selected account', () => {
    render(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'No Account Selected'
    );
  });

  it('should allow selecting an account', () => {
    render(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    act(() => {
      screen.getByText('Select Account').click();
    });

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'Selected: 1234567890'
    );
  });

  it('should allow clearing the selected account', () => {
    render(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    act(() => {
      screen.getByText('Select Account').click();
    });

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'Selected: 1234567890'
    );

    act(() => {
      screen.getByText('Clear Selection').click();
    });

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'No Account Selected'
    );
  });

  it('should clear selected account when user changes to prevent data leakage', () => {
    const { rerender } = render(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    // Select an account
    act(() => {
      screen.getByText('Select Account').click();
    });

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'Selected: 1234567890'
    );

    // Change user (simulate sign out/sign in with different user)
    mockUseAuth.mockReturnValue({
      user: { userId: 'user-2', name: 'Different User' },
      isAuthenticated: true,
      isLoading: false,
    });

    rerender(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    // Selected account should be cleared
    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'No Account Selected'
    );
  });

  it('should clear selected account when user signs out', () => {
    const { rerender } = render(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    // Select an account
    act(() => {
      screen.getByText('Select Account').click();
    });

    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'Selected: 1234567890'
    );

    // User signs out
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });

    rerender(
      <SelectedAccountProvider>
        <TestComponent />
      </SelectedAccountProvider>
    );

    // Selected account should be cleared
    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'No Account Selected'
    );
  });

  it('should throw error when useSelectedAccount is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty to suppress console errors during this test
    });

    expect(() => {
      render(<TestComponent />);
    }).toThrow(
      'useSelectedAccount must be used within SelectedAccountProvider'
    );

    consoleSpy.mockRestore();
  });
});
