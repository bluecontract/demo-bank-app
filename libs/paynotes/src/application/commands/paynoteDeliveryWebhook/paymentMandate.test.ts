import { describe, expect, it } from 'vitest';
import { PAYNOTE_DELIVERY_BLUE_ID } from '../../payNoteDelivery/schema';
import { toCompactBlueJsonValue } from '../../blue/compactBlue';
import { blue } from '../../../blue';
import { getConcretePaymentMandateBootstrapRequest } from './paymentMandate';

const toDeliveryDocument = (yaml: string): Record<string, unknown> => {
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node, 'original') as Record<string, unknown>;
};

describe('getConcretePaymentMandateBootstrapRequest', () => {
  it('returns null when delivery has no concrete payment mandate bootstrap request', () => {
    const deliveryDocument = toDeliveryDocument(`
name: Delivery without mandate
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  document:
    type: PayNote/Card Transaction PayNote
`);
    const compact = toCompactBlueJsonValue(deliveryDocument) as Record<
      string,
      unknown
    >;

    const request = getConcretePaymentMandateBootstrapRequest(compact);
    expect(request).toBeNull();
  });

  it('extracts concrete payment mandate bootstrap request from compact delivery payload', () => {
    const deliveryDocument = toDeliveryDocument(`
name: Delivery with payment mandate
paymentMandateBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  requestId: mandate-bootstrap-1
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    granterChannel:
      accountId: merchant-account
    granteeChannel:
      accountId: merchant-account
  document:
    name: Delivery mandate
    type: PayNote/Payment Mandate
    granterType: merchant
    granterId: merchant-1
    granteeType: documentId
    granteeId: paynote-doc-1
    amountLimit: 50000
    currency: USD
    sourceAccount: root
    contracts:
      granterChannel:
        type: MyOS/MyOS Timeline Channel
      granteeChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
`);
    const compact = toCompactBlueJsonValue(deliveryDocument) as Record<
      string,
      unknown
    >;

    const request = getConcretePaymentMandateBootstrapRequest(compact);

    expect(request).not.toBeNull();
    expect(request?.requestId).toBe('mandate-bootstrap-1');
    expect(request?.bootstrapAssignee).toBe('payNoteDeliverer');
    expect(request?.document).toMatchObject({
      type: 'PayNote/Payment Mandate',
      granterType: 'merchant',
      amountLimit: 50000,
      currency: 'USD',
    });
  });
});
