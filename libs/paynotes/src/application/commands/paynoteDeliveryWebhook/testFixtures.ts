const TEXT_BLUE_ID = 'DLRQwz7MQeCrzjy9bohPNwtCxKEBbKaMK65KBrwjfG6K';
const DOCUMENT_BOOTSTRAP_REQUESTED_BLUE_ID =
  '4derXUpwPZDDkBpYPCTMr6t3mbeGU7AUYmvfW22cZior';
const REQUEST_BLUE_ID = '8f9UhHMbRe62sFgzQVheToaJPYi7t7HPNVvpQTbqfL5n';
const PAYNOTE_DELIVERY_BLUE_ID = 'E22dx85oPtGX2DPRaKJzHVizREJmioNCJPurgBcHHhJ';

export const buildSchemaShapedDocumentBootstrapRequestedEvent = () => ({
  description: 'Request to bootstrap the provided document.',
  type: {
    name: 'Document Bootstrap Requested',
    description: 'Request to bootstrap the provided document.',
    blueId: DOCUMENT_BOOTSTRAP_REQUESTED_BLUE_ID,
    type: {
      name: 'Request',
      description:
        'The base type for any event that represents a specific, trackable request to another participant or service.',
      blueId: REQUEST_BLUE_ID,
      requestId: {
        description:
          'A caller-generated ID for this specific request. This ID is used by the recipient to correlate their response.',
        type: { blueId: TEXT_BLUE_ID },
      },
    },
    document: {
      description: 'Target Blue document to bootstrap.',
    },
    requestId: {
      description:
        'A caller-generated ID for this specific request. This ID is used by the recipient to correlate their response.',
      type: { blueId: TEXT_BLUE_ID },
    },
    bootstrapAssignee: {
      description:
        'Channel name of a participant in the requesting document which is asked to bootstrap the requested document',
      type: { blueId: TEXT_BLUE_ID },
    },
  },
  bootstrapAssignee: {
    type: { blueId: TEXT_BLUE_ID },
    value: 'synchronyChannel',
  },
  document: {
    name: 'Schema-shaped delivery',
    type: {
      name: 'PayNote Delivery',
      description:
        'Tracks delivery of a PayNote through a deliverer (e.g., bank) to a receiver (payer - client).',
      blueId: PAYNOTE_DELIVERY_BLUE_ID,
    },
  },
});

export const buildSchemaShapedDocumentBootstrapRequestedNode = () => ({
  description:
    'Payload for the operation. Shape MUST match the target Operation request contract.',
  type: {
    blueId: DOCUMENT_BOOTSTRAP_REQUESTED_BLUE_ID,
  },
  requestId: {
    type: { blueId: TEXT_BLUE_ID },
    value: 'request-1',
  },
  bootstrapAssignee: {
    type: { blueId: TEXT_BLUE_ID },
    value: 'synchronyChannel',
  },
  channelBindings: {
    type: {
      blueId: 'G7fBT9PSod1RfHLHkpafAGBDVAJMrMhAMY51ERcyXNrj',
    },
    keyType: { blueId: TEXT_BLUE_ID },
    valueType: {
      blueId: 'DcoJyCh7XXxy1nR5xjy7qfkUgQ1GiZnKKSxh8DJusBSr',
    },
    payNoteSender: {
      accountId: {
        type: { blueId: TEXT_BLUE_ID },
        value: 'merchant-account',
      },
    },
    cardProcessorChannel: {
      accountId: {
        type: { blueId: TEXT_BLUE_ID },
        value: 'processor-account',
      },
    },
  },
  document: {
    name: 'Schema-shaped delivery',
    type: {
      blueId: PAYNOTE_DELIVERY_BLUE_ID,
    },
  },
});

export const buildSynchronyDocumentWithCheckpointBootstrapRequest = () => ({
  name: 'Synchrony Merchant',
  type: 'Synchrony/Merchant',
  checkpoint: {
    lastEvents: {
      merchantChannel: {
        message: {
          request: buildSchemaShapedDocumentBootstrapRequestedNode(),
        },
      },
    },
  },
});
