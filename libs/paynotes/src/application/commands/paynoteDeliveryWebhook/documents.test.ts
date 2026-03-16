import { describe, expect, it, vi } from 'vitest';
import coreBlueIds from '@blue-repository/types/packages/core/blue-ids';
import { blue } from '../../../blue';
import { resolveDeliveryDocumentId } from './documents';

const buildDocumentProcessingInitiatedEvent = (documentId: string) => {
  const node = blue.yamlToNode(`documentId: ${documentId}`);
  node.setType(
    blue.jsonValueToNode({
      blueId: coreBlueIds['Core/Document Processing Initiated'],
    })
  );
  return blue.nodeToJson(node);
};

describe('resolveDeliveryDocumentId', () => {
  it('prefers document id emitted in the webhook payload before fetching by session', async () => {
    const fetchDocument = vi
      .fn()
      .mockRejectedValue(new Error('fetchDocument should not run'));

    const documentId = await resolveDeliveryDocumentId(
      'delivery-session-1',
      [buildDocumentProcessingInitiatedEvent('delivery-doc-1')],
      [],
      {
        myOsClient: {
          fetchDocument,
        },
      } as any
    );

    expect(documentId).toBe('delivery-doc-1');
    expect(fetchDocument).not.toHaveBeenCalled();
  });
});
