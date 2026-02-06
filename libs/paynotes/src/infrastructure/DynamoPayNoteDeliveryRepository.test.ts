import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoPayNoteDeliveryRepository } from './DynamoPayNoteDeliveryRepository';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';

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
}));

const { PutCommand, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);
const mockQueryCommand = vi.mocked(QueryCommand);

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
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter((item): item is { PK: string } => Boolean(item));

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
          transactionId: 'txn-1',
          deliveryDocument: {
            name: 'Delivery for Invoice',
            payNoteBootstrapRequest: {
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
        amountMinor: 1200,
        currency: 'USD',
        transactionId: 'txn-1',
      }),
    ]);
  });
});
