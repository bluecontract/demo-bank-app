import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { AccountCard } from './AccountCard';

const mockAccount = {
  accountId: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking Account',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  accountType: 'DEPOSIT' as const,
  creditLimitMinor: undefined,
  ledgerBalanceMinor: 50000,
  availableBalanceMinor: 45000,
  status: 'active',
};

const creditLineAccount = {
  ...mockAccount,
  accountId: 'acc-456',
  name: 'Merchant Credit Line',
  accountType: 'CREDIT_LINE' as const,
  creditLimitMinor: 500000,
  ledgerBalanceMinor: 400000,
  availableBalanceMinor: 350000,
};

describe('AccountCard', () => {
  it('renders account information correctly', () => {
    render(<AccountCard account={mockAccount} />);

    expect(screen.getByText('Checking Account')).toBeInTheDocument();
    expect(screen.getByText('123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('$450')).toBeInTheDocument();
  });

  it('renders custom account name when provided', () => {
    const customAccount = { ...mockAccount, name: 'Business Account' };
    render(<AccountCard account={customAccount} />);

    expect(screen.getByText('Business Account')).toBeInTheDocument();
  });

  it('calls onSelect when card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <AccountCard
        account={mockAccount}
        onSelect={onSelect}
        showActions={false}
      />
    );

    const cardButton = screen.getByRole('button', {
      name: 'Select Checking Account',
    });
    fireEvent.click(cardButton);

    expect(onSelect).toHaveBeenCalledWith(mockAccount.accountId);
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

  it('calls onFundClick when Fund button is clicked', () => {
    const onFundClick = vi.fn();
    render(<AccountCard account={mockAccount} onFundClick={onFundClick} />);

    const fundButton = screen.getByRole('button', { name: 'Fund' });
    fireEvent.click(fundButton);

    expect(onFundClick).toHaveBeenCalledWith(mockAccount.accountId);
  });

  it('renders action buttons for deposit accounts', () => {
    render(
      <AccountCard
        account={mockAccount}
        onFundClick={vi.fn()}
        onTransferClick={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'New transfer' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fund' })).toBeInTheDocument();
  });

  it('renders credit line details and edit button', () => {
    render(
      <AccountCard
        account={creditLineAccount}
        onEditCreditLimitClick={vi.fn()}
      />
    );

    expect(screen.getByText('Merchant Credit Line')).toBeInTheDocument();
    expect(screen.getByText('$3,500')).toBeInTheDocument();
    expect(screen.getByText('Limit: $5,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('hides action buttons when showActions is false', () => {
    render(<AccountCard account={mockAccount} showActions={false} />);

    expect(
      screen.queryByRole('button', { name: 'New transfer' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Fund' })
    ).not.toBeInTheDocument();
  });

  it('hides credit line actions when showActions is false', () => {
    render(<AccountCard account={creditLineAccount} showActions={false} />);

    expect(screen.getByText('Limit: $5,000')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument();
  });

  it('calls onEditCreditLimitClick when Edit button is clicked', () => {
    const onEditCreditLimitClick = vi.fn();
    render(
      <AccountCard
        account={creditLineAccount}
        onEditCreditLimitClick={onEditCreditLimitClick}
      />
    );

    const editButton = screen.getByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    expect(onEditCreditLimitClick).toHaveBeenCalledWith(
      creditLineAccount.accountId
    );
  });

  it('does not render transfer action when transfer handler is not provided', () => {
    render(<AccountCard account={mockAccount} />);

    expect(
      screen.queryByRole('button', { name: 'New transfer' })
    ).not.toBeInTheDocument();
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
    expect(balance).toHaveClass('balance-display', 'text-slate-900');
  });

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(
      <AccountCard account={mockAccount} isSelected={true} />
    );

    const cardElement = container.querySelector('.ring-2');
    expect(cardElement).toBeInTheDocument();
  });

  it('applies default styling when isSelected is false', () => {
    const { container } = render(
      <AccountCard account={mockAccount} isSelected={false} />
    );

    const cardElement = container.querySelector('.ring-2');
    expect(cardElement).not.toBeInTheDocument();
  });

  it('applies default styling when isSelected is not provided', () => {
    const { container } = render(<AccountCard account={mockAccount} />);

    const cardElement = container.querySelector('.ring-2');
    expect(cardElement).not.toBeInTheDocument();
  });

  it('should show tooltip with full account name on hover', () => {
    render(<AccountCard account={mockAccount} />);

    const accountName = screen.getByText('Checking Account');
    fireEvent.mouseEnter(accountName);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Checking Account');
  });

  it('should hide tooltip when mouse leaves', () => {
    render(<AccountCard account={mockAccount} />);

    const accountName = screen.getByText('Checking Account');
    fireEvent.mouseEnter(accountName);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(accountName);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should apply text truncation to account name', () => {
    const longNameAccount = {
      ...mockAccount,
      name: 'This is a very long account name that should be truncated with ellipsis',
    };

    render(<AccountCard account={longNameAccount} />);

    const accountName = screen.getByText(
      'This is a very long account name that should be truncated with ellipsis'
    );
    expect(accountName).toHaveClass('truncate');
  });

  it('should show full account name in tooltip even when truncated', () => {
    const longNameAccount = {
      ...mockAccount,
      name: 'This is a very long account name that should be truncated with ellipsis',
    };

    render(<AccountCard account={longNameAccount} />);

    const accountName = screen.getByText(
      'This is a very long account name that should be truncated with ellipsis'
    );
    fireEvent.mouseEnter(accountName);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute(
      'aria-label',
      'This is a very long account name that should be truncated with ellipsis'
    );
  });
});
