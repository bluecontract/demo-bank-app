import { render, screen } from '@testing-library/react';
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

describe('CardsPanel', () => {
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
    const issueButton = screen.getByRole('button', { name: 'Issue Card' });
    expect(issueButton).toBeDisabled();
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

    expect(screen.getByText('**** 4242')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue Card' })).toBeEnabled();
  });
});
