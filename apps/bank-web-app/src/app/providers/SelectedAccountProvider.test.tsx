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
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  ledgerBalanceMinor: 100000,
  availableBalanceMinor: 100000,
  status: 'ACTIVE',
};

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
