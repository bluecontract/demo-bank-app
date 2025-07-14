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

  it('calls onDetailsClick when Details button is clicked', () => {
    const onDetailsClick = vi.fn();
    render(
      <AccountCard account={mockAccount} onDetailsClick={onDetailsClick} />
    );

    const detailsButton = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(detailsButton);

    expect(onDetailsClick).toHaveBeenCalledWith(mockAccount.accountId);
  });

  it('calls onTransferClick when New transfer button is clicked', () => {
    const onTransferClick = vi.fn();
    render(
      <AccountCard account={mockAccount} onTransferClick={onTransferClick} />
    );

    const transferButton = screen.getByRole('button', { name: 'New transfer' });
    fireEvent.click(transferButton);

    expect(onTransferClick).toHaveBeenCalledWith(mockAccount.accountId);
  });

  it('calls onFundClick when Fund Account button is clicked', () => {
    const onFundClick = vi.fn();
    render(<AccountCard account={mockAccount} onFundClick={onFundClick} />);

    const fundButton = screen.getByRole('button', { name: 'Fund Account' });
    fireEvent.click(fundButton);

    expect(onFundClick).toHaveBeenCalledWith(mockAccount.accountId);
  });

  it('renders all three action buttons', () => {
    render(<AccountCard account={mockAccount} />);

    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New transfer' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Fund Account' })
    ).toBeInTheDocument();
  });

  it('does not call handlers when not provided', () => {
    render(<AccountCard account={mockAccount} />);

    const detailsButton = screen.getByRole('button', { name: 'Details' });
    const transferButton = screen.getByRole('button', { name: 'New transfer' });
    const fundButton = screen.getByRole('button', { name: 'Fund Account' });

    expect(() => {
      fireEvent.click(detailsButton);
      fireEvent.click(transferButton);
      fireEvent.click(fundButton);
    }).not.toThrow();
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

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(
      <AccountCard account={mockAccount} isSelected={true} />
    );

    const cardElement = container.querySelector(
      '.border-2.border-blue-300.bg-blue-50'
    );
    expect(cardElement).toBeInTheDocument();
  });

  it('applies default styling when isSelected is false', () => {
    const { container } = render(
      <AccountCard account={mockAccount} isSelected={false} />
    );

    const cardElement = container.querySelector(
      '.border-2.border-blue-300.bg-blue-50'
    );
    expect(cardElement).not.toBeInTheDocument();
  });

  it('applies default styling when isSelected is not provided', () => {
    const { container } = render(<AccountCard account={mockAccount} />);

    const cardElement = container.querySelector(
      '.border-2.border-blue-300.bg-blue-50'
    );
    expect(cardElement).not.toBeInTheDocument();
  });
});
