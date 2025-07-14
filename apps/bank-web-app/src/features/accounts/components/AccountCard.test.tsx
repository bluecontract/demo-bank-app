import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { AccountCard } from './AccountCard';

const mockAccount = {
  accountId: 'acc-123',
  accountNumber: '1234567890',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  ledgerBalanceMinor: 50000,
  availableBalanceMinor: 45000,
  status: 'active',
};

describe('AccountCard', () => {
  it('renders account information correctly', () => {
    render(<AccountCard account={mockAccount} />);

    expect(screen.getByText('Checking Account')).toBeInTheDocument();
    expect(screen.getByText('123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('$450')).toBeInTheDocument();
  });

  it('renders custom account name when provided', () => {
    const customName = 'Business Account';
    render(<AccountCard account={mockAccount} accountName={customName} />);

    expect(screen.getByText(customName)).toBeInTheDocument();
  });

  it('displays correct currency formatting', () => {
    const highBalanceAccount = {
      ...mockAccount,
      availableBalanceMinor: 123456789, // $1,234,567.89
    };

    render(<AccountCard account={highBalanceAccount} />);

    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument();
  });

  it('displays zero balance correctly', () => {
    const zeroBalanceAccount = {
      ...mockAccount,
      availableBalanceMinor: 0,
    };

    render(<AccountCard account={zeroBalanceAccount} />);

    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('has proper styling classes', () => {
    render(<AccountCard account={mockAccount} />);

    const accountNumber = screen.getByText('123 456 7890');
    expect(accountNumber).toHaveClass('account-number');

    const balance = screen.getByText('$450');
    expect(balance).toHaveClass('balance-display', 'text-green-600');
  });
});
