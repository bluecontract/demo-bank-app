import { describe, expect, it } from 'vitest';
import type { Hold, HoldEvent } from '../../../domain/entities/Hold';
import {
  buildHoldEventItem,
  buildHoldMetaItem,
  mapHoldEventItemToHoldEvent,
  mapHoldMetaItemToHold,
  parseHoldEventSortKey,
} from './items';

describe('Hold Dynamo item mappers', () => {
  const hold: Hold = {
    holdId: 'hold-123',
    payerAccountNumber: 'ACC-100',
    counterpartyAccountNumber: 'ACC-200',
    amountMinor: 12_500,
    currency: 'USD',
    status: 'PENDING',
    description: 'Test hold',
    createdAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-02-01T00:00:00.000Z',
    relatedTransactionId: 'txn-789',
    releasedAt: '2024-01-05T00:00:00.000Z',
    releaseReason: 'Cancelled',
    merchantId: 'merchant-abc',
    payNoteDocumentId: 'doc-123',
  };

  it('should round-trip hold meta items', () => {
    const item = buildHoldMetaItem(hold);

    expect(item).toMatchObject({
      PK: 'HOLD#hold-123',
      SK: 'META',
      HOLD_GSI1PK: 'ACCOUNT#ACC-100',
      HOLD_GSI1SK: 'PENDING#2024-01-01T00:00:00.000Z#hold-123',
      holdId: 'hold-123',
      payerAccountNumber: 'ACC-100',
      amountMinor: 12_500,
      currency: 'USD',
      status: 'PENDING',
      description: 'Test hold',
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-02-01T00:00:00.000Z',
      relatedTransactionId: 'txn-789',
      releasedAt: '2024-01-05T00:00:00.000Z',
      releaseReason: 'Cancelled',
      merchantId: 'merchant-abc',
      payNoteDocumentId: 'doc-123',
    });

    const mappedHold = mapHoldMetaItemToHold(item);
    expect(mappedHold).toEqual(hold);
  });

  it('should round-trip hold event items', () => {
    const event: HoldEvent = {
      at: '2024-01-01T01:00:00.000Z',
      type: 'CAPTURED',
      transactionId: 'txn-123',
      counterpartyAccountNumber: 'ACC-200',
      payNoteDocumentId: 'paynote-capture',
    };
    const eventId = 'event-abc';

    const item = buildHoldEventItem(hold, event, { eventId });

    expect(item).toMatchObject({
      PK: 'HOLD#hold-123',
      SK: `EVENT#${event.at}#${eventId}`,
      HOLD_EVENT_GSI1PK: 'ACCOUNT#ACC-100',
      HOLD_EVENT_GSI1SK: `EVENT#${event.at}#${hold.holdId}#${eventId}`,
      holdId: hold.holdId,
      eventId,
      at: event.at,
      type: event.type,
      amountMinor: hold.amountMinor,
      description: hold.description,
      payerAccountNumber: hold.payerAccountNumber,
      counterpartyAccountNumber: hold.counterpartyAccountNumber,
      payload: {
        transactionId: 'txn-123',
        counterpartyAccountNumber: 'ACC-200',
        payNoteDocumentId: 'paynote-capture',
      },
    });

    expect(parseHoldEventSortKey(item.SK)).toEqual({
      at: event.at,
      eventId,
    });

    const mappedEvent = mapHoldEventItemToHoldEvent(item);
    expect(mappedEvent).toEqual(event);
  });

  it('should handle optional fields on CREATED events', () => {
    const event: HoldEvent = {
      at: '2024-01-01T02:00:00.000Z',
      type: 'CREATED',
      createdByUserId: 'user-999',
      idempotencyKeyHash: 'hash-123',
      payNoteDocumentId: 'paynote-created',
    };
    const item = buildHoldEventItem(hold, event, {
      eventId: 'event-def',
    });

    expect(item.payload).toEqual({
      createdByUserId: 'user-999',
      idempotencyKeyHash: 'hash-123',
      payNoteDocumentId: 'paynote-created',
    });
    expect(mapHoldEventItemToHoldEvent(item)).toEqual(event);
  });

  it('should include failure details', () => {
    const event: HoldEvent = {
      at: '2024-01-01T03:00:00.000Z',
      type: 'FAILED',
      code: 'VALIDATION',
      message: 'Invalid amount',
      payNoteDocumentId: 'paynote-failed',
    };

    const item = buildHoldEventItem(hold, event, {
      eventId: 'event-ghi',
    });

    expect(item.payload).toEqual({
      code: 'VALIDATION',
      message: 'Invalid amount',
      payNoteDocumentId: 'paynote-failed',
    });
    expect(mapHoldEventItemToHoldEvent(item)).toEqual(event);
  });
});
