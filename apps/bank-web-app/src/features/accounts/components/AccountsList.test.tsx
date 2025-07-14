import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccountsList } from './AccountsList';

const mockAccounts = [
  {
    accountId: '123e4567-e89b-12d3-a456-426614174000',
    accountNumber: '1234567890',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 1030000,
    availableBalanceMinor: 1030000,
    status: 'ACTIVE',
  },
  {
    accountId: '123e4567-e89b-12d3-a456-426614174001',
    accountNumber: '1234567891',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 500000,
    availableBalanceMinor: 500000,
    status: 'ACTIVE',
  },
];

describe('AccountsList', () => {
  it('should render list of accounts', () => {
    render(<AccountsList accounts={mockAccounts} onCreateAccount={vi.fn()} />);

    expect(screen.getByText('$10,300')).toBeInTheDocument();
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText('123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('123 456 7891')).toBeInTheDocument();
  });

  it('should render add account card', () => {
    render(<AccountsList accounts={mockAccounts} onCreateAccount={vi.fn()} />);

    expect(screen.getByText('Add new account')).toBeInTheDocument();
  });

  it('should handle create account click', () => {
    const handleCreateAccount = vi.fn();
    render(
      <AccountsList
        accounts={mockAccounts}
        onCreateAccount={handleCreateAccount}
      />
    );

    const addAccountCard = screen.getByText('Add new account');
    addAccountCard.click();

    expect(handleCreateAccount).toHaveBeenCalledTimes(1);
  });

  it('should have responsive grid layout', () => {
    render(
      <AccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        data-testid="accounts-list"
      />
    );

    const grid = screen.getByTestId('accounts-list');
    expect(grid).toHaveClass('grid');
  });

  it('should render empty state when no accounts', () => {
    render(<AccountsList accounts={[]} onCreateAccount={vi.fn()} />);

    expect(screen.getByText('Add new account')).toBeInTheDocument();
  });

  it('should show loading state for add account card', () => {
    render(
      <AccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        isCreatingAccount={true}
      />
    );

    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });
});
