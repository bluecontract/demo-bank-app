import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type {
  PayNoteDeliveryDetailsSanitized,
  PayNoteDeliverySummary,
} from '../../../types/api';
import {
  applyOptimisticProposalDecision,
  rollbackOptimisticProposalDecision,
} from './proposalDecisionOptimistic';

const buildProposal = (
  overrides: Partial<PayNoteDeliverySummary>
): PayNoteDeliverySummary => ({
  deliveryId: 'delivery-1',
  deliverySessionId: 'session-1',
  from: { name: 'Merchant' },
  createdAt: '2026-02-08T10:00:00.000Z',
  updatedAt: '2026-02-08T10:00:00.000Z',
  ...overrides,
});

const buildProposalDetails = (
  overrides: Partial<PayNoteDeliveryDetailsSanitized>
): PayNoteDeliveryDetailsSanitized => ({
  deliveryId: 'delivery-1',
  from: { name: 'Merchant' },
  createdAt: '2026-02-08T10:00:00.000Z',
  updatedAt: '2026-02-08T10:00:00.000Z',
  ...overrides,
});

describe('proposalDecisionOptimistic', () => {
  it('applies optimistic decision without changing updatedAt ordering fields', async () => {
    const queryClient = new QueryClient();
    const initialUpdatedAt = '2026-02-08T10:00:00.000Z';

    queryClient.setQueryData<PayNoteDeliverySummary[]>(
      ['proposals'],
      [
        buildProposal({
          deliveryId: 'delivery-1',
          deliverySessionId: 'session-1',
          clientDecisionStatus: 'pending',
          updatedAt: initialUpdatedAt,
        }),
        buildProposal({
          deliveryId: 'delivery-2',
          deliverySessionId: 'session-2',
          clientDecisionStatus: 'pending',
          updatedAt: '2026-02-08T11:00:00.000Z',
        }),
      ]
    );
    queryClient.setQueryData<PayNoteDeliverySummary[]>(
      ['paynote-deliveries'],
      [
        buildProposal({
          deliveryId: 'delivery-1',
          deliverySessionId: 'session-1',
          clientDecisionStatus: 'pending',
          updatedAt: initialUpdatedAt,
        }),
      ]
    );
    queryClient.setQueryData<PayNoteDeliveryDetailsSanitized>(
      ['proposal-details', 'session-1'],
      buildProposalDetails({
        deliverySessionId: 'session-1',
        clientDecisionStatus: 'pending',
        updatedAt: initialUpdatedAt,
      })
    );

    await applyOptimisticProposalDecision(queryClient, 'session-1', 'accepted');

    const proposals = queryClient.getQueryData<PayNoteDeliverySummary[]>([
      'proposals',
    ]);
    const payNoteDeliveries = queryClient.getQueryData<
      PayNoteDeliverySummary[]
    >(['paynote-deliveries']);
    const proposalDetails =
      queryClient.getQueryData<PayNoteDeliveryDetailsSanitized>([
        'proposal-details',
        'session-1',
      ]);

    expect(
      proposals?.find(item => item.deliverySessionId === 'session-1')
        ?.clientDecisionStatus
    ).toBe('accepted');
    expect(
      proposals?.find(item => item.deliverySessionId === 'session-1')?.updatedAt
    ).toBe(initialUpdatedAt);
    expect(payNoteDeliveries?.[0]?.updatedAt).toBe(initialUpdatedAt);
    expect(proposalDetails?.clientDecisionStatus).toBe('accepted');
    expect(proposalDetails?.updatedAt).toBe(initialUpdatedAt);
  });

  it('rolls back optimistic decision to previous values', async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData<PayNoteDeliverySummary[]>(
      ['proposals'],
      [
        buildProposal({
          deliveryId: 'delivery-1',
          deliverySessionId: 'session-1',
          clientDecisionStatus: 'pending',
        }),
      ]
    );

    const snapshot = await applyOptimisticProposalDecision(
      queryClient,
      'session-1',
      'rejected'
    );

    rollbackOptimisticProposalDecision(queryClient, snapshot);

    const proposals = queryClient.getQueryData<PayNoteDeliverySummary[]>([
      'proposals',
    ]);
    expect(proposals?.[0]?.clientDecisionStatus).toBe('pending');
  });
});
