import { describe, expect, it } from 'vitest';
import type { PayNoteDeliveryRecord } from '../../ports';
import { resolveDeliveryStorageIdentity } from './deliveryUpdate';

describe('resolveDeliveryStorageIdentity', () => {
  it('keeps base delivery id for brand new delivery records', () => {
    const resolved = resolveDeliveryStorageIdentity({
      baseDeliveryId: 'rrn|stan|tdt|auth',
      deliveryDocumentId: 'delivery-doc-1',
      existing: null,
      matchedBy: 'new',
    });

    expect(resolved).toEqual({
      deliveryId: 'rrn|stan|tdt|auth',
      existing: null,
      matchedBy: 'new',
      collidedByCardDetails: false,
    });
  });

  it('retains existing delivery when card details point to same delivery document', () => {
    const existing = {
      deliveryId: 'rrn|stan|tdt|auth',
      deliveryDocumentId: 'delivery-doc-1',
    } as PayNoteDeliveryRecord;

    const resolved = resolveDeliveryStorageIdentity({
      baseDeliveryId: 'rrn|stan|tdt|auth',
      deliveryDocumentId: 'delivery-doc-1',
      existing,
      matchedBy: 'cardDetails',
    });

    expect(resolved).toEqual({
      deliveryId: 'rrn|stan|tdt|auth',
      existing,
      matchedBy: 'cardDetails',
      collidedByCardDetails: false,
    });
  });

  it('allocates a unique delivery id when card-details lookup hits a different document', () => {
    const existing = {
      deliveryId: 'rrn|stan|tdt|auth',
      deliveryDocumentId: 'delivery-doc-root',
    } as PayNoteDeliveryRecord;

    const resolved = resolveDeliveryStorageIdentity({
      baseDeliveryId: 'rrn|stan|tdt|auth',
      deliveryDocumentId: 'delivery-doc-linked',
      existing,
      matchedBy: 'cardDetails',
    });

    expect(resolved).toEqual({
      deliveryId: 'rrn|stan|tdt|auth#delivery:delivery-doc-linked',
      existing: null,
      matchedBy: 'new',
      collidedByCardDetails: true,
    });
  });
});
