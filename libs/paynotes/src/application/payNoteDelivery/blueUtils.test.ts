import { describe, expect, it } from 'vitest';
import { PAYNOTE_DELIVERY_BLUE_ID } from './schema';
import { blue } from '../../blue';
import {
  getCardTransactionDetailsFromDocument,
  getSynchronySessionIdFromDocument,
  getProposalDescriptionFromDeliveryDocument,
} from './blueUtils';

const buildDeliveryDocument = (input?: {
  initialMessagesYaml?: string;
  payNoteInitialStateDescriptionYaml?: string;
}) => {
  const initialMessagesYaml = input?.initialMessagesYaml ?? '';
  const payNoteInitialStateDescriptionYaml =
    input?.payNoteInitialStateDescriptionYaml ?? '';
  const yaml = `name: Delivery for Invoice
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
${initialMessagesYaml}  document:
    type: PayNote/Card Transaction PayNote
    currency: USD
    amount:
      total: 1200
${payNoteInitialStateDescriptionYaml}cardTransactionDetails:
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

const buildCardTransactionPayNote = () =>
  blue.nodeToJson(
    blue.yamlToNode(`type: PayNote/Card Transaction PayNote
name: Root PayNote
currency: USD
amount:
  total: 1200
cardTransactionDetails:
  retrievalReferenceNumber: "123456789012"
  systemTraceAuditNumber: "654321"
  transmissionDateTime: "0101123456"
  authorizationCode: "ABC123"
`)
  ) as Record<string, unknown>;

const buildBlueIdOnlyDeliveryDocument = () => ({
  name: 'Raw Delivery',
  type: {
    blueId: PAYNOTE_DELIVERY_BLUE_ID,
  },
  cardTransactionDetails: {
    retrievalReferenceNumber: {
      value: '123456789012',
    },
    systemTraceAuditNumber: {
      value: '654321',
    },
    transmissionDateTime: {
      value: '0101123456',
    },
    authorizationCode: {
      value: 'ABC123',
    },
  },
});

const buildBlueIdOnlyDeliveryDocumentWithSynchronyLink = () => ({
  ...buildBlueIdOnlyDeliveryDocument(),
  contracts: {
    links: {
      synchronyMerchantLink: {
        type: {
          blueId: 'd1vQ8ZTPcQc5KeuU6tzWaVukWRVtKjQL4hbvbpC22rB',
        },
        sessionId: {
          value: 'canonical-sync-session',
        },
      },
    },
  },
});

describe('getProposalDescriptionFromDeliveryDocument', () => {
  it('reads card transaction details from a card transaction paynote', () => {
    expect(
      getCardTransactionDetailsFromDocument(buildCardTransactionPayNote())
    ).toEqual({
      retrievalReferenceNumber: '123456789012',
      systemTraceAuditNumber: '654321',
      transmissionDateTime: '0101123456',
      authorizationCode: 'ABC123',
    });
  });

  it('reads card transaction details from blueId-only delivery documents', () => {
    expect(
      getCardTransactionDetailsFromDocument(buildBlueIdOnlyDeliveryDocument())
    ).toEqual({
      retrievalReferenceNumber: '123456789012',
      systemTraceAuditNumber: '654321',
      transmissionDateTime: '0101123456',
      authorizationCode: 'ABC123',
    });
  });

  it('reads synchrony session id from blueId-only delivery documents', () => {
    expect(
      getSynchronySessionIdFromDocument(
        buildBlueIdOnlyDeliveryDocumentWithSynchronyLink()
      )
    ).toBe('canonical-sync-session');
  });

  it('prefers payNote initial message over bootstrap initial messages', () => {
    const document = buildDeliveryDocument({
      initialMessagesYaml: `  initialMessages:
    defaultMessage: Default proposal message
    perChannel:
      payerChannel: Payer specific proposal message
`,
      payNoteInitialStateDescriptionYaml: `    payNoteInitialStateDescription:
      initialMessage: Preferred proposal message
`,
    });

    expect(getProposalDescriptionFromDeliveryDocument(document)).toBe(
      'Preferred proposal message'
    );
  });

  it('prefers payerChannel message over default message', () => {
    const document = buildDeliveryDocument({
      initialMessagesYaml: `  initialMessages:
    defaultMessage: Default proposal message
    perChannel:
      payerChannel: Payer specific proposal message
`,
    });

    expect(getProposalDescriptionFromDeliveryDocument(document)).toBe(
      'Payer specific proposal message'
    );
  });

  it('falls back to default message when payerChannel is missing', () => {
    const document = buildDeliveryDocument({
      initialMessagesYaml: `  initialMessages:
    defaultMessage: Default proposal message
`,
    });

    expect(getProposalDescriptionFromDeliveryDocument(document)).toBe(
      'Default proposal message'
    );
  });

  it('falls back to bootstrap message when payNote initial message is empty', () => {
    const document = buildDeliveryDocument({
      initialMessagesYaml: `  initialMessages:
    defaultMessage: Default proposal message
`,
      payNoteInitialStateDescriptionYaml: `    payNoteInitialStateDescription:
      initialMessage: "   "
`,
    });

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
