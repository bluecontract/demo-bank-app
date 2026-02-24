import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProposalDetailsPanel } from './ProposalDetailsPanel';
import type { PayNoteDeliveryDetailsSanitized } from '../../../types/api';
import { routerFutureConfig } from '../../../app/routerFutureConfig';

vi.mock('../hooks', () => ({
  useAcceptPayNoteDelivery: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
  }),
  useRejectPayNoteDelivery: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
  }),
  useProposalSummary: () => ({
    data: null,
    isFetching: false,
    timedOut: true,
    error: null,
  }),
}));

vi.mock('../../accounts/hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [{ accountNumber: '1234567890', accountId: 'account-1' }],
  }),
}));

vi.mock('../../transactions/hooks/useActivity', () => ({
  useActivity: () => ({
    data: { items: [], nextCursor: undefined },
    isLoading: false,
  }),
}));

const proposal: PayNoteDeliveryDetailsSanitized = {
  deliveryId: 'delivery-1',
  deliverySessionId: 'session-1',
  deliveryStatus: 'pending',
  transactionIdentificationStatus: 'identified',
  clientDecisionStatus: 'pending',
  payNote: {
    name: 'Slow Digestion PayNote',
    amountMinor: 1200,
    currency: 'USD',
  },
  from: {
    name: 'Merchant',
  },
  accountNumber: '1234567890',
  transactionId: 'txn-123',
  holdId: 'hold-55',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('ProposalDetailsPanel', () => {
  it('shows related activity placeholders for proposal transactions', () => {
    render(
      <MemoryRouter future={routerFutureConfig}>
        <ProposalDetailsPanel proposal={proposal} sessionId="session-1" />
      </MemoryRouter>
    );

    expect(screen.getByText('Related activity')).toBeInTheDocument();
    expect(screen.getByText('Transaction txn-123')).toBeInTheDocument();
    expect(screen.queryByText('Hold hold-55')).not.toBeInTheDocument();
  });
});
