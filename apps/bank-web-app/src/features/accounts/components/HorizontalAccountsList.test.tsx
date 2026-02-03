import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { HorizontalAccountsList } from './HorizontalAccountsList';

const mockUseSelectedAccount = vi.fn();
vi.mock('../../../app/providers/SelectedAccountProvider', () => ({
  useSelectedAccount: () => mockUseSelectedAccount(),
}));

const mockAccounts = [
  {
    accountId: '1',
    accountNumber: '1234567890',
    name: 'Checking Account',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    accountType: 'DEPOSIT' as const,
    creditLimitMinor: undefined,
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
    accountType: 'DEPOSIT' as const,
    creditLimitMinor: undefined,
    ledgerBalanceMinor: 250000,
    availableBalanceMinor: 250000,
    status: 'ACTIVE',
  },
];

describe('HorizontalAccountsList', () => {
  const mockSetSelectedAccount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: null,
      setSelectedAccount: mockSetSelectedAccount,
    });
  });

  it('should render accounts horizontally', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    expect(screen.getByText('123 456 7890')).toBeInTheDocument();
    expect(screen.getByText('987 654 3210')).toBeInTheDocument();
  });

  it('should render add account card', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    expect(screen.getByText('Add new account')).toBeInTheDocument();
  });

  it('should call onCreateAccount when add account button is clicked', () => {
    const mockOnCreateAccount = vi.fn();
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={mockOnCreateAccount}
        onTransfer={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Add new account'));
    expect(mockOnCreateAccount).toHaveBeenCalled();
  });

  it('should call onTransfer when transfer button is clicked', () => {
    const mockOnTransfer = vi.fn();
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={mockOnTransfer}
      />
    );

    const transferButtons = screen.getAllByText('Transfer');
    fireEvent.click(transferButtons[0]);
    expect(mockOnTransfer).toHaveBeenCalledWith('1');
  });

  it('should select account when details button is clicked', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    const detailsButtons = screen.getAllByText('Details');
    fireEvent.click(detailsButtons[0]);
    expect(mockSetSelectedAccount).toHaveBeenCalledWith(mockAccounts[0]);
  });

  it('should select account when card is clicked in selectOnCardClick mode', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
        showActions={false}
        selectOnCardClick={true}
      />
    );

    const cardButton = screen.getByRole('button', {
      name: 'Select Checking Account',
    });
    fireEvent.click(cardButton);
    expect(mockSetSelectedAccount).toHaveBeenCalledWith(mockAccounts[0]);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });

  it('should show selected account with different styling', () => {
    mockUseSelectedAccount.mockReturnValue({
      selectedAccount: mockAccounts[0],
      setSelectedAccount: mockSetSelectedAccount,
    });

    const { container } = render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    const selectedCard = container.querySelector('.ring-2');
    expect(selectedCard).toBeInTheDocument();
  });

  it('should show loading state when creating account', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
        isCreatingAccount={true}
      />
    );

    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });

  it('should initially not show arrows', () => {
    render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    expect(screen.queryByTestId('scroll-left-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scroll-right-btn')).not.toBeInTheDocument();
  });

  it('should have proper container styling', () => {
    const { container } = render(
      <HorizontalAccountsList
        accounts={mockAccounts}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
        data-testid="accounts-container"
      />
    );

    const mainContainer = screen.getByTestId('accounts-container');
    expect(mainContainer).toHaveClass('relative');

    const scrollContainer = container.querySelector(
      '.overflow-x-auto.scrollbar-hide'
    );
    expect(scrollContainer).toBeInTheDocument();
  });

  it('should handle empty accounts array', () => {
    render(
      <HorizontalAccountsList
        accounts={[]}
        onCreateAccount={vi.fn()}
        onTransfer={vi.fn()}
      />
    );

    expect(screen.getByText('Add new account')).toBeInTheDocument();
    expect(screen.queryByText('123 456 7890')).not.toBeInTheDocument();
  });
});
