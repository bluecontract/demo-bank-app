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
  it('replaces proposal with contract when session id matches', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: undefined }],
      [baseProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);
  });

  it('replaces proposal with contract even when bootstrapped', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: 'bootstrapped' }],
      [baseProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);
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

  it('replaces proposal when delivery session matches contract session', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, sessionId: 'proposal-session-1' }],
      [{ ...baseProposal, payNoteSessionIds: [] }]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);
  });

  it('replaces accepted proposal with contract when names match', () => {
    const result = mergeContractsAndProposals(
      [
        {
          ...baseContract,
          sessionId: undefined,
          displayName: 'Sample Contract',
        },
      ],
      [
        {
          ...baseProposal,
          payNoteSessionIds: [],
          deliverySessionId: undefined,
          name: 'Sample Contract',
          clientDecisionStatus: 'accepted',
        },
      ]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);
  });

  it('keeps rejected proposals even when session id matches', () => {
    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: 'active' }],
      [
        {
          ...baseProposal,
          clientDecisionStatus: 'rejected',
        },
      ]
    );

    expect(result.some(item => isProposalItem(item))).toBe(true);
  });

  it('dedupes multiple proposals that map to the same contract', () => {
    const newerProposal = {
      ...baseProposal,
      deliveryId: 'delivery-2',
      updatedAt: '2026-02-01T10:06:00.000Z',
    };

    const result = mergeContractsAndProposals(
      [{ ...baseContract, status: 'active' }],
      [baseProposal, newerProposal]
    );

    expect(result).toHaveLength(1);
    expect(isProposalItem(result[0])).toBe(false);

    const contractItem = result[0] as ContractSummary & {
      originProposalDeliveryId?: string;
      sortUpdatedAt?: string;
    };

    expect(contractItem.originProposalDeliveryId).toBe('delivery-2');
    expect(contractItem.sortUpdatedAt).toBe(newerProposal.updatedAt);
  });
});
