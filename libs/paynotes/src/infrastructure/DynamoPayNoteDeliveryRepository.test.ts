import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoPayNoteDeliveryRepository } from './DynamoPayNoteDeliveryRepository';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import { PAYNOTE_DELIVERY_BLUE_ID } from '../application/payNoteDelivery/schema';
import { toCompactBlueJsonValue } from '../application/blue/compactBlue';
import { blue } from '../blue';

const mockSend = vi.fn();
const mockDocumentClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => mockDocumentClient),
  },
  PutCommand: vi.fn(payload => payload),
  GetCommand: vi.fn(payload => payload),
  QueryCommand: vi.fn(payload => payload),
  UpdateCommand: vi.fn(payload => payload),
  DeleteCommand: vi.fn(payload => payload),
}));

const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } =
  await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);
const mockGetCommand = vi.mocked(GetCommand);
const mockQueryCommand = vi.mocked(QueryCommand);
const mockUpdateCommand = vi.mocked(UpdateCommand);
const mockDeleteCommand = vi.mocked(DeleteCommand);

const createRepository = () =>
  new DynamoPayNoteDeliveryRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

describe('DynamoPayNoteDeliveryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks event processed with conditional put', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    const result = await repository.markEventProcessed('event-1');

    expect(result).toBe(true);
    expect(mockPutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
    const eventItem = mockPutCommand.mock.calls[0]?.[0]?.Item as
      | { status?: string }
      | undefined;
    expect(eventItem?.status).toBe('processing');
  });

  it('returns false when event already processed', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('ConditionalCheckFailedException'), {
        name: 'ConditionalCheckFailedException',
      })
    );
    const repository = createRepository();

    const result = await repository.markEventProcessed('event-1');

    expect(result).toBe(false);
  });

  it('finalizes claimed event processing', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.finalizeEventProcessing?.('event-1');

    expect(mockUpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
  });

  it('releases claimed event processing lock', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.releaseEventProcessing?.('event-1');

    expect(mockDeleteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        ConditionExpression: '#status = :processing',
      })
    );
  });

  it('ignores release when lock is not in processing state', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('ConditionalCheckFailedException'), {
        name: 'ConditionalCheckFailedException',
      })
    );
    const repository = createRepository();

    await expect(
      repository.releaseEventProcessing?.('event-1')
    ).resolves.toBeUndefined();
  });

  it('persists delivery and mapping items', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    const cardDetails = {
      retrievalReferenceNumber: '123456789012',
      systemTraceAuditNumber: '654321',
      transmissionDateTime: '0101123456',
      authorizationCode: 'ABC123',
    };
    const cardDetailsKey = buildCardTransactionDetailsKey(cardDetails);

    await repository.saveDelivery({
      deliveryId: 'delivery-1',
      deliverySessionIds: ['session-1', 'session-2'],
      cardTransactionDetails: cardDetails,
      cardTransactionDetailsKey: cardDetailsKey,
      payNoteDocumentId: 'paynote-doc-1',
      userId: 'user-1',
      merchantId: 'merchant-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter((item): item is { PK: string; merchantId?: string } =>
        Boolean(item)
      );

    expect(
      savedItems.some(item => item.PK === 'PAYNOTE_DELIVERY#delivery-1')
    ).toBe(true);
    expect(
      savedItems.some(item => item.PK === 'PAYNOTE_DELIVERY_SESSION#session-1')
    ).toBe(true);
    expect(
      savedItems.some(item => item.PK === 'PAYNOTE_DELIVERY_SESSION#session-2')
    ).toBe(true);
    expect(
      savedItems.some(
        item => item.PK === `PAYNOTE_DELIVERY_CARD_TXN#${cardDetailsKey}`
      )
    ).toBe(true);
    expect(
      savedItems.some(
        item => item.PK === 'PAYNOTE_DELIVERY_PAYNOTE_DOCUMENT#paynote-doc-1'
      )
    ).toBe(true);
    expect(savedItems.some(item => item.PK === 'USER#user-1')).toBe(true);
    expect(
      savedItems.find(item => item.PK === 'PAYNOTE_DELIVERY#delivery-1')
        ?.merchantId
    ).toBe('merchant-1');
  });

  it('compacts delivery and paynote documents before persistence', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    const deliveryNode = blue.yamlToNode(`name: Delivery for Invoice
type: PayNote/PayNote Delivery
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: merchant-account
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  document:
    type: PayNote/Card Transaction PayNote
    amount:
      total: 1200`);
    deliveryNode.setType(
      blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID })
    );
    const expandedDeliveryDocument = blue.nodeToJson(
      deliveryNode,
      'official'
    ) as Record<string, unknown>;

    const payNoteNode = blue.yamlToNode(`type: PayNote/PayNote
name: Voucher
contracts:
  payerChannel:
    type: MyOS/MyOS Timeline Channel
  payeeChannel:
    type: MyOS/MyOS Timeline Channel
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel`);
    const expandedPayNoteDocument = blue.nodeToJson(
      payNoteNode,
      'official'
    ) as Record<string, unknown>;

    await repository.saveDelivery({
      deliveryId: 'delivery-compact',
      deliveryDocument: expandedDeliveryDocument,
      payNoteDocument: expandedPayNoteDocument,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const deliveryItem = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .find(item => item?.PK === 'PAYNOTE_DELIVERY#delivery-compact');

    expect(deliveryItem).toEqual(
      expect.objectContaining({
        deliveryDocument: toCompactBlueJsonValue(expandedDeliveryDocument),
        payNoteDocument: toCompactBlueJsonValue(expandedPayNoteDocument),
      })
    );
  });

  it('lists deliveries by user with summary fields', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#user-1',
            SK: 'PAYNOTE_DELIVERY#2024-01-01T00:00:00.000Z#delivery-1',
            entityType: 'PAYNOTE_DELIVERY_USER',
            deliveryId: 'delivery-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY#delivery-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          merchantId: 'merchant-1',
          summary: {
            story: {
              headline: 'PayNote proposal',
              overview: ['A proposal summary.'],
              bullets: [],
            },
            listPreview: 'PayNote proposal updated.',
            nextSteps: {
              title: 'Next steps',
              items: ['Review the proposal.'],
            },
            lastChange: {
              short: 'PayNote proposal updated.',
              more: 'Details updated.',
            },
          },
          summaryUpdatedAt: '2024-01-02T00:00:00.000Z',
          summarySourceEpoch: 0,
          transactionId: 'txn-1',
          deliveryDocument: {
            type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
            name: 'Delivery for Invoice',
            payNoteBootstrapRequest: {
              initialMessages: {
                defaultMessage: 'Default proposal description',
                perChannel: {
                  payerChannel: 'Payer-specific proposal description',
                },
              },
              document: {
                name: 'Invoice 42',
                amount: { total: 1200 },
                currency: 'USD',
                payNoteInitialStateDescription: {
                  initialMessage: 'Preferred proposal description',
                },
              },
            },
          },
        },
      });

    const repository = createRepository();
    const result = await repository.listDeliveriesByUserId('user-1');

    expect(mockQueryCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        ScanIndexForward: false,
      })
    );
    expect(result).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-1',
        name: 'Invoice 42',
        proposalDescription: 'Preferred proposal description',
        amountMinor: 1200,
        currency: 'USD',
        transactionId: 'txn-1',
        merchantId: 'merchant-1',
      }),
    ]);
  });

  it('keeps proposalDescription for non-initial summary epochs', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#user-1',
            SK: 'PAYNOTE_DELIVERY#2024-01-01T00:00:00.000Z#delivery-1',
            entityType: 'PAYNOTE_DELIVERY_USER',
            deliveryId: 'delivery-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY#delivery-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          summary: {
            story: {
              headline: 'Updated proposal',
              overview: ['Updated details'],
              bullets: [],
            },
            listPreview: 'Updated summary.',
            nextSteps: {
              title: 'Next steps',
              items: ['Review updates'],
            },
            lastChange: {
              short: 'Updated summary.',
              more: 'Details changed.',
            },
          },
          summaryUpdatedAt: '2024-01-02T00:00:00.000Z',
          summarySourceEpoch: 1,
          deliveryDocument: {
            type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
            payNoteBootstrapRequest: {
              initialMessages: {
                defaultMessage: 'Initial message',
                perChannel: {
                  payerChannel: 'Payer initial message',
                },
              },
              document: {
                name: 'Invoice 42',
                amount: { total: 1200 },
                currency: 'USD',
              },
            },
          },
        },
      });

    const repository = createRepository();
    const result = await repository.listDeliveriesByUserId('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.proposalDescription).toBe('Payer initial message');
  });

  it('uses payNote initial message from payNoteDocument when delivery document lacks it', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#user-1',
            SK: 'PAYNOTE_DELIVERY#2024-01-01T00:00:00.000Z#delivery-1',
            entityType: 'PAYNOTE_DELIVERY_USER',
            deliveryId: 'delivery-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY#delivery-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          summary: {
            story: {
              headline: 'Generated headline',
              overview: ['Generated overview'],
              bullets: [],
            },
            listPreview: 'Generated list preview',
            nextSteps: {
              title: 'Next steps',
              items: [],
            },
            lastChange: {
              short: 'Generated list preview',
              more: 'Generated list preview',
            },
          },
          summaryUpdatedAt: '2024-01-02T00:00:00.000Z',
          deliveryDocument: {
            type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
            payNoteBootstrapRequest: {
              initialMessages: {
                defaultMessage: 'Legacy fallback message',
              },
              document: {
                name: 'Invoice 42',
                amount: { total: 1200 },
                currency: 'USD',
              },
            },
          },
          payNoteDocument: {
            name: 'Invoice 42',
            amount: { total: 1200 },
            currency: 'USD',
            payNoteInitialStateDescription: {
              initialMessage: 'super nice offer only for you',
            },
          },
        },
      });

    const repository = createRepository();
    const result = await repository.listDeliveriesByUserId('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.proposalDescription).toBe(
      'super nice offer only for you'
    );
  });

  it('uses consistent read for session lookup mapping', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY_SESSION#session-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY_SESSION',
          sessionId: 'session-1',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY#delivery-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });
    const repository = createRepository();

    await repository.getDeliveryBySessionId('session-1');

    expect(mockGetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: {
          PK: 'PAYNOTE_DELIVERY_SESSION#session-1',
          SK: 'META',
        },
        ConsistentRead: true,
      })
    );
  });

  it('uses consistent read for bootstrap lookup mapping', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY_BOOTSTRAP#bootstrap-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY_BOOTSTRAP',
          bootstrapSessionId: 'bootstrap-1',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_DELIVERY#delivery-1',
          SK: 'META',
          entityType: 'PAYNOTE_DELIVERY',
          deliveryId: 'delivery-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });
    const repository = createRepository();

    await repository.getDeliveryByBootstrapSessionId('bootstrap-1');

    expect(mockGetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: {
          PK: 'PAYNOTE_DELIVERY_BOOTSTRAP#bootstrap-1',
          SK: 'META',
        },
        ConsistentRead: true,
      })
    );
  });
});
