import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CardsPanel } from './CardsPanel';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import { useCards } from '../hooks/useCards';
import { useCardDetails } from '../hooks/useCardDetails';

vi.mock('../../../app/providers/SelectedAccountProvider', () => ({
  useSelectedAccount: vi.fn(),
}));

vi.mock('../hooks/useCards', () => ({
  useCards: vi.fn(),
}));

vi.mock('../hooks/useCardDetails', () => ({
  useCardDetails: vi.fn(),
}));

vi.mock('./IssueCardModal', () => ({
  IssueCardModal: () => <div data-testid="issue-card-modal" />,
}));

const mockCardDetailsModal = vi.fn();
vi.mock('./CardDetailsModal', () => ({
  CardDetailsModal: (props: any) => {
    mockCardDetailsModal(props);
    return <div data-testid="card-details-modal" />;
  },
}));

describe('CardsPanel', () => {
  beforeEach(() => {
    mockCardDetailsModal.mockClear();
  });

  it('shows placeholder when no account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({ selectedAccount: null });
    (useCards as any).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel />);

    expect(
      screen.getByText('Select an account to manage cards.')
    ).toBeInTheDocument();
    const issueButton = screen.getByRole('button', { name: 'Issue' });
    expect(issueButton).toBeDisabled();
  });

  it('shows loading state when cards are loading', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel />);

    expect(screen.getByTestId('cards-loading-state')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue' })).toBeEnabled();
  });

  it('shows error state when cards fail to load', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel />);

    expect(screen.getByTestId('cards-error-state')).toBeInTheDocument();
  });

  it('shows empty state when no cards exist', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel />);

    expect(screen.getByTestId('cards-empty-state')).toBeInTheDocument();
  });

  it('renders cards when account is selected', () => {
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [
        {
          cardId: 'card-1',
          accountId: 'acc-1',
          accountNumber: '1234567890',
          cardholderName: 'Test User',
          panLast4: '4242',
          expiryMonth: 12,
          expiryYear: 2030,
          status: 'ACTIVE',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel />);

    expect(screen.getByText('***4242')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue' })).toBeEnabled();
  });

  it('selects a card when clicked', () => {
    const handleSelect = vi.fn();
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [
        {
          cardId: 'card-1',
          accountId: 'acc-1',
          accountNumber: '1234567890',
          cardholderName: 'Test User',
          panLast4: '4242',
          expiryMonth: 12,
          expiryYear: 2030,
          status: 'ACTIVE',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel selectedCardId="card-1" onSelectCard={handleSelect} />);

    fireEvent.click(screen.getByTestId('card-item-card-1'));

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'card-1' })
    );
  });

  it('opens card details when details button is clicked', () => {
    const handleSelect = vi.fn();
    (useSelectedAccount as any).mockReturnValue({
      selectedAccount: {
        accountId: 'acc-1',
        accountNumber: '1234567890',
        name: 'Primary',
        currency: 'USD',
        createdAt: '2023-01-01T00:00:00Z',
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: 100000,
        availableBalanceMinor: 100000,
        status: 'ACTIVE',
      },
    });
    (useCards as any).mockReturnValue({
      data: [
        {
          cardId: 'card-1',
          accountId: 'acc-1',
          accountNumber: '1234567890',
          cardholderName: 'Test User',
          panLast4: '4242',
          expiryMonth: 12,
          expiryYear: 2030,
          status: 'ACTIVE',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as any);
    (useCardDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<CardsPanel selectedCardId="card-1" onSelectCard={handleSelect} />);

    fireEvent.click(screen.getByTestId('card-details-button-card-1'));

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'card-1' })
    );
    expect(mockCardDetailsModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ isOpen: true })
    );
  });
});
