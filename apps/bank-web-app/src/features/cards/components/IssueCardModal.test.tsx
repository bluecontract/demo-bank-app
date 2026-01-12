import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IssueCardModal } from './IssueCardModal';
import { useIssueCard } from '../hooks/useIssueCard';

vi.mock('../hooks/useIssueCard', () => ({
  useIssueCard: vi.fn(),
}));

const mockIssuedCard = {
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
  pan: '1234567890124242',
  cvc: '123',
};

describe('IssueCardModal', () => {
  it('renders form when open and issues card', () => {
    const onClose = vi.fn();
    const reset = vi.fn();
    const mutate = vi.fn((data, options) => {
      options?.onSuccess?.(mockIssuedCard);
    });

    (useIssueCard as any).mockReturnValue({
      mutate,
      reset,
      isPending: false,
    });

    render(
      <IssueCardModal
        isOpen
        onClose={onClose}
        accountId="acc-1"
        accountName="Primary"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Issue Card' }));

    expect(mutate).toHaveBeenCalledWith(
      { accountId: 'acc-1', cardholderName: undefined },
      expect.any(Object)
    );
    expect(screen.getByTestId('issued-card-pan')).toHaveTextContent(
      mockIssuedCard.pan
    );
    expect(screen.getByTestId('issued-card-cvc')).toHaveTextContent(
      mockIssuedCard.cvc
    );
  });

  it('does not render when closed', () => {
    const onClose = vi.fn();
    const reset = vi.fn();

    (useIssueCard as any).mockReturnValue({
      mutate: vi.fn(),
      reset,
      isPending: false,
    });

    render(
      <IssueCardModal
        isOpen={false}
        onClose={onClose}
        accountId="acc-1"
        accountName="Primary"
      />
    );

    expect(
      screen.queryByTestId('issue-card-modal-content')
    ).not.toBeInTheDocument();
  });
});
