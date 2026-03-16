import { describe, expect, it } from 'vitest';
import {
  applyMonitoringDecisionToContract,
  upsertMonitoringRequestInContract,
  type ContractRecord,
} from '@demo-bank-app/contracts';

const createContract = (): ContractRecord => ({
  contractId: 'contract-1',
  typeBlueId: 'type-1',
  displayName: 'Contract',
  sessionId: 'session-1',
  documentId: 'document-1',
  userId: 'user-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('monitoring domain transitions', () => {
  it('creates pending action and subscription for new monitoring request', () => {
    const contract = createContract();

    const result = upsertMonitoringRequestInContract({
      contract,
      targetMerchantId: 'merchant-1',
      requestedEvents: ['transaction'],
      requestEventId: 'event-1',
      requestEventIndex: 0,
      requestedAt: '2024-01-01T01:00:00.000Z',
      requestId: 'request-1',
    });

    expect(result.changed).toBe(true);
    if (!result.changed) {
      return;
    }

    expect(result.action).toEqual(
      expect.objectContaining({
        actionId: 'card-monitoring:merchant-1:consent',
        type: 'monitoringConsentApproval',
        status: 'pending',
        requestId: 'request-1',
      })
    );
    expect(result.subscription).toEqual(
      expect.objectContaining({
        subscriptionId: 'card-monitoring:merchant-1',
        status: 'pending',
        pendingActionId: 'card-monitoring:merchant-1:consent',
        requestId: 'request-1',
      })
    );
    expect(contract.pendingActions).toBeUndefined();
    expect(contract.monitoringSubscriptions).toBeUndefined();
  });

  it('deduplicates request when subscription is already pending', () => {
    const contract: ContractRecord = {
      ...createContract(),
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'pending',
          pendingActionId: 'card-monitoring:merchant-1:consent',
          requestEventId: 'event-old',
          requestEventIndex: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = upsertMonitoringRequestInContract({
      contract,
      targetMerchantId: 'merchant-1',
      requestedEvents: ['transaction'],
      requestEventId: 'event-1',
      requestEventIndex: 0,
      requestedAt: '2024-01-01T01:00:00.000Z',
    });

    expect(result.changed).toBe(false);
    if (result.changed) {
      return;
    }
    expect(result.reason).toBe('already-pending');
  });

  it('accepts pending action and activates subscription', () => {
    const contract: ContractRecord = {
      ...createContract(),
      pendingActions: [
        {
          actionId: 'card-monitoring:merchant-1:consent',
          type: 'monitoringConsentApproval',
          status: 'pending',
          title: 'Allow card transaction monitoring',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'pending',
          pendingActionId: 'card-monitoring:merchant-1:consent',
          requestEventId: 'event-1',
          requestEventIndex: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = applyMonitoringDecisionToContract({
      contract,
      actionId: 'card-monitoring:merchant-1:consent',
      decision: 'accepted',
      decidedAt: '2024-01-01T02:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.action.status).toBe('accepted');
    expect(result.subscription).toEqual(
      expect.objectContaining({
        status: 'active',
        activatedAt: '2024-01-01T02:00:00.000Z',
      })
    );
    expect(result.subscription).not.toHaveProperty('pendingActionId');
    expect(result.subscription).not.toHaveProperty('rejectedAt');
  });

  it('rejects pending action and marks subscription rejected', () => {
    const contract: ContractRecord = {
      ...createContract(),
      pendingActions: [
        {
          actionId: 'card-monitoring:merchant-1:consent',
          type: 'monitoringConsentApproval',
          status: 'pending',
          title: 'Allow card transaction monitoring',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'pending',
          pendingActionId: 'card-monitoring:merchant-1:consent',
          requestEventId: 'event-1',
          requestEventIndex: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = applyMonitoringDecisionToContract({
      contract,
      actionId: 'card-monitoring:merchant-1:consent',
      decision: 'rejected',
      decidedAt: '2024-01-01T02:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.action.status).toBe('rejected');
    expect(result.subscription).toEqual(
      expect.objectContaining({
        status: 'rejected',
        rejectedAt: '2024-01-01T02:00:00.000Z',
      })
    );
    expect(result.subscription).not.toHaveProperty('pendingActionId');
    expect(result.subscription).not.toHaveProperty('activatedAt');
  });
});
