import { describe, it, expect, vi } from 'vitest';
import { identifyDeliveryTransaction } from './identification';
import type { PayNoteDeliveryRecord } from '../../ports';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';

describe('identifyDeliveryTransaction', () => {
  it('captures merchantId from the identified hold', async () => {
    const deliveryRecord: PayNoteDeliveryRecord = {
      deliveryId: 'delivery-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const deps: HandlePayNoteDeliveryWebhookDependencies = {
      myOsClient: {} as any,
      payNoteDeliveryRepository: {} as any,
      contractRepository: {} as any,
      bankingRepository: {
        getAccountIdByNumber: vi.fn().mockResolvedValue('acct-1'),
        getAccountById: vi.fn().mockResolvedValue({
          id: 'acct-1',
          accountNumber: '1234567890',
          ownerUserId: 'user-1',
        }),
      } as any,
      holdRepository: {
        getHoldByCardTransactionDetails: vi.fn().mockResolvedValue({
          holdId: 'hold-1',
          payerAccountNumber: '1234567890',
          relatedTransactionId: 'txn-1',
          merchantId: 'merchant-1',
        }),
      } as any,
      bootstrapContextRepository: {} as any,
      clock: { now: () => new Date() },
    };

    const hold = await identifyDeliveryTransaction({
      deliveryRecord,
      cardDetails: {
        retrievalReferenceNumber: '123',
        systemTraceAuditNumber: '456',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      eventId: 'event-1',
      deliveryId: 'delivery-1',
      deps,
      logs: [],
    });

    expect(hold?.holdId).toBe('hold-1');
    expect(deliveryRecord.userId).toBe('user-1');
    expect(deliveryRecord.holdId).toBe('hold-1');
    expect(deliveryRecord.merchantId).toBe('merchant-1');
    expect(deliveryRecord.transactionIdentificationStatus).toBe('identified');
  });
});
