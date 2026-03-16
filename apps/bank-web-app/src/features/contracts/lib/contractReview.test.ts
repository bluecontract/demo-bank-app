import { describe, expect, it } from 'vitest';
import type { ContractOrProposalItem } from './contractsAndProposals';
import { getItemChangeType } from './contractReview';

const baseProposal: ContractOrProposalItem = {
  kind: 'proposal',
  deliveryId: 'delivery-1',
  deliverySessionId: 'session-1',
  from: { name: 'Merchant' },
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:05:00.000Z',
};

describe('getItemChangeType', () => {
  it('treats pending proposal as unread when not reviewed', () => {
    const result = getItemChangeType(
      {
        ...baseProposal,
        clientDecisionStatus: 'pending',
      },
      {}
    );

    expect(result).toBe('new');
  });

  it('does not mark accepted proposal as unread', () => {
    const result = getItemChangeType(
      {
        ...baseProposal,
        clientDecisionStatus: 'accepted',
      },
      {}
    );

    expect(result).toBeNull();
  });

  it('does not mark rejected proposal as unread', () => {
    const result = getItemChangeType(
      {
        ...baseProposal,
        clientDecisionStatus: 'rejected',
      },
      {}
    );

    expect(result).toBeNull();
  });
});
