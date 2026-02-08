import { describe, expect, it } from 'vitest';
import { PAYNOTE_DELIVERY_BLUE_ID } from './schema';
import { blue } from '../../blue';
import { getProposalDescriptionFromDeliveryDocument } from './blueUtils';

const buildDeliveryDocument = (initialMessagesYaml = '') => {
  const yaml = `name: Delivery for Invoice
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
${initialMessagesYaml}  document:
    type: PayNote/Card Transaction PayNote
    currency: USD
    amount:
      total: 1200
cardTransactionDetails:
  retrievalReferenceNumber: "123456789012"
  systemTraceAuditNumber: "654321"
  transmissionDateTime: "0101123456"
  authorizationCode: "ABC123"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: merchant-account
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

describe('getProposalDescriptionFromDeliveryDocument', () => {
  it('prefers payerChannel message over default message', () => {
    const document = buildDeliveryDocument(`  initialMessages:
    defaultMessage: Default proposal message
    perChannel:
      payerChannel: Payer specific proposal message
`);

    expect(getProposalDescriptionFromDeliveryDocument(document)).toBe(
      'Payer specific proposal message'
    );
  });

  it('falls back to default message when payerChannel is missing', () => {
    const document = buildDeliveryDocument(`  initialMessages:
    defaultMessage: Default proposal message
`);

    expect(getProposalDescriptionFromDeliveryDocument(document)).toBe(
      'Default proposal message'
    );
  });

  it('returns undefined when bootstrap messages are unavailable', () => {
    const document = buildDeliveryDocument();
    expect(
      getProposalDescriptionFromDeliveryDocument(document)
    ).toBeUndefined();
  });
});
