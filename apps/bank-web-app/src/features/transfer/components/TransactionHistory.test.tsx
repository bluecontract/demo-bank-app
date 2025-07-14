import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { TransactionHistory } from './TransactionHistory';

const mockUseSelectedAccount = vi.fn();
vi.mock('../../../app/providers/SelectedAccountProvider', () => ({
  useSelectedAccount: () => mockUseSelectedAccount(),
}));

const mockAccount = {
  accountId: 'test-account-id',
  accountNumber: '1234567890',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  ledgerBalanceMinor: 100000,
  availableBalanceMinor: 100000,
  status: 'ACTIVE',
};

describe('TransactionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show transaction history header even when no account is selected', () => {
    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: null,
      setSelectedAccount: vi.fn(),
    });

    render(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });

  it('should show transaction history header with account number when account is selected', () => {
    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    render(<TransactionHistory />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.getByText('Account: 1234567890')).toBeInTheDocument();
  });

  it('should show empty state when account is selected but no transactions exist', () => {
    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: mockAccount,
      setSelectedAccount: vi.fn(),
    });

    render(<TransactionHistory />);

    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your transaction history will appear here once you make your first transfer'
      )
    ).toBeInTheDocument();
  });

  it('should display the correct account number', () => {
    const customAccount = {
      ...mockAccount,
      accountNumber: '9876543210',
    };

    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: customAccount,
      setSelectedAccount: vi.fn(),
    });

    render(<TransactionHistory />);

    expect(screen.getByText('Account: 9876543210')).toBeInTheDocument();
  });
});
