import { describe, it, expect } from 'vitest';
import type {
  ContractSummary,
  PayNoteDeliverySummary,
} from '../../../types/api';
import {
  mergeContractsAndProposals,
  isProposalItem,
} from './contractsAndProposals';

const baseContract: ContractSummary = {
  contractId: 'contract-1',
  typeBlueId: 'type-blue-1',
  displayName: 'Sample Contract',
  sessionId: 'contract-session-1',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:05:00.000Z',
};

const baseProposal: PayNoteDeliverySummary = {
  deliveryId: 'delivery-1',
  deliverySessionId: 'proposal-session-1',
  payNoteSessionIds: ['contract-session-1'],
  createdAt: '2026-02-01T10:02:00.000Z',
  updatedAt: '2026-02-01T10:03:00.000Z',
};

describe('mergeContractsAndProposals', () => {
  it('keeps proposal visible when contract status is missing', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: undefined }],
      [baseProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(true);
  });

  it('keeps proposal visible when contract is bootstrapped', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: 'bootstrapped' }],
      [baseProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(true);
  });

  it('replaces proposal with contract once ready', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: 'active' }],
      [baseProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);

    const contractItem = result[0] as ContractSummary & {
      originProposalDeliveryId?: string;
      originProposalSessionId?: string;
      sortUpdatedAt?: string;
    };

    expect(contractItem.originProposalDeliveryId).toBe('delivery-1');
    expect(contractItem.originProposalSessionId).toBe('proposal-session-1');
    expect(contractItem.sortUpdatedAt).toBe(baseProposal.updatedAt);
  });
});
