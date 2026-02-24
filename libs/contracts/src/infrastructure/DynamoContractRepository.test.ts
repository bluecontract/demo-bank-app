import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Blue, BlueNode } from '@blue-labs/language';
import { DynamoContractRepository } from './DynamoContractRepository';

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
}));

const { PutCommand, GetCommand } = await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);
const mockGetCommand = vi.mocked(GetCommand);

const createRepository = () =>
  new DynamoContractRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

const buildResolvedPayload = () => {
  const typeNode = new BlueNode()
    .setBlueId('type-root')
    .setName('TypeRoot')
    .setDescription('Resolved type metadata should not be persisted');

  const node = new BlueNode().setType(typeNode).setProperties({
    nested: new BlueNode().setType(typeNode.clone()).setValue('payload'),
  });

  return new Blue().nodeToJson(node, 'official') as Record<string, unknown>;
};

describe('DynamoContractRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists merchantId on contract items', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.saveContract({
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      documentName: 'Invoice 42',
      sessionId: 'session-1',
      documentId: 'doc-1',
      status: 'active',
      userId: 'user-1',
      merchantId: 'merchant-1',
      relatedTransactionIds: ['txn-1'],
      relatedHoldIds: ['hold-1'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter((item): item is { PK: string; merchantId?: string } =>
        Boolean(item)
      );

    const contractItem = savedItems.find(
      item => item.PK === 'CONTRACT#contract-1'
    );
    expect(contractItem?.merchantId).toBe('merchant-1');

    const userItem = savedItems.find(item => item.PK === 'USER#user-1');
    expect(userItem?.merchantId).toBe('merchant-1');

    const transactionItem = savedItems.find(item => item.PK === 'TXN#txn-1');
    expect(transactionItem?.merchantId).toBe('merchant-1');

    const holdItem = savedItems.find(item => item.PK === 'HOLD#hold-1');
    expect(holdItem?.merchantId).toBe('merchant-1');
  });

  it('uses consistent read for session lookup mapping', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT_SESSION#session-1',
          SK: 'META',
          entityType: 'CONTRACT_SESSION',
          sessionId: 'session-1',
          contractId: 'contract-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT#contract-1',
          SK: 'META',
          entityType: 'CONTRACT',
          contractId: 'contract-1',
          sessionId: 'session-1',
          typeBlueId: 'type-1',
          displayName: 'Contract',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.getContractBySessionId('session-1');

    expect(mockGetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: {
          PK: 'CONTRACT_SESSION#session-1',
          SK: 'META',
        },
        ConsistentRead: true,
      })
    );
  });

  it('returns null for non-canonical mapped session lookups', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT_SESSION#session-2',
          SK: 'META',
          entityType: 'CONTRACT_SESSION',
          sessionId: 'session-2',
          contractId: 'contract-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT#contract-1',
          SK: 'META',
          entityType: 'CONTRACT',
          contractId: 'contract-1',
          sessionId: 'session-1',
          typeBlueId: 'type-1',
          displayName: 'Contract',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({});
    const repository = createRepository();

    const contract = await repository.getContractBySessionId('session-2');

    expect(contract).toBeNull();
  });

  it('uses consistent read for document lookup mapping', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT_DOCUMENT#document-1',
          SK: 'META',
          entityType: 'CONTRACT_DOCUMENT',
          documentId: 'document-1',
          contractId: 'contract-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'CONTRACT#contract-1',
          SK: 'META',
          entityType: 'CONTRACT',
          contractId: 'contract-1',
          typeBlueId: 'type-1',
          displayName: 'Contract',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.getContractByDocumentId('document-1');

    expect(mockGetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: {
          PK: 'CONTRACT_DOCUMENT#document-1',
          SK: 'META',
        },
        ConsistentRead: true,
      })
    );
  });

  it('links additional session mapping to existing contract', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.linkSessionToContract({
      sessionId: 'session-2',
      contractId: 'contract-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    expect(mockPutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Item: expect.objectContaining({
          PK: 'CONTRACT_SESSION#session-2',
          SK: 'META',
          sessionId: 'session-2',
          contractId: 'contract-1',
        }),
        ConditionExpression: 'attribute_not_exists(PK) OR contractId = :cid',
        ExpressionAttributeValues: {
          ':cid': 'contract-1',
        },
      })
    );
  });

  it('prefers summary headline when persisting summaryPreview', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.saveContract({
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      sessionId: 'session-1',
      status: 'active',
      userId: 'user-1',
      summary: {
        story: {
          headline: 'Bank confirmed lock',
          overview: ['Overview'],
          bullets: [],
        },
        listPreview: 'Setup started',
        nextSteps: { title: 'Next steps', items: [] },
        lastChange: {
          short: 'Bank confirmed lock',
          more: 'More context',
        },
      },
      summaryPreview: 'Setup started',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter((item): item is { PK: string; summaryPreview?: string } =>
        Boolean(item)
      );

    const contractItem = savedItems.find(
      item => item.PK === 'CONTRACT#contract-1'
    );
    expect(contractItem?.summaryPreview).toBe('Bank confirmed lock');

    const userItem = savedItems.find(item => item.PK === 'USER#user-1');
    expect(userItem?.summaryPreview).toBe('Bank confirmed lock');
  });

  it('stores compact snapshots for document and events', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();
    const expandedPayload = buildResolvedPayload();

    await repository.saveContract({
      contractId: 'contract-compact',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      sessionId: 'session-compact',
      documentId: 'doc-compact',
      document: expandedPayload,
      triggerEvent: expandedPayload,
      emittedEvents: [expandedPayload],
      summaryTriggerEvent: expandedPayload,
      summaryEmittedEvents: [expandedPayload],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter(
        (
          item
        ): item is {
          PK: string;
          SK: string;
          triggerEvent?: Record<string, unknown>;
          emittedEvents?: Array<Record<string, unknown>>;
          summaryTriggerEvent?: Record<string, unknown>;
          summaryEmittedEvents?: Array<Record<string, unknown>>;
          document?: Record<string, unknown>;
        } => Boolean(item)
      );

    const contractItem = savedItems.find(
      item => item.PK === 'CONTRACT#contract-compact' && item.SK === 'META'
    );
    expect(contractItem?.triggerEvent?.type).toEqual({ blueId: 'type-root' });
    expect(contractItem?.emittedEvents?.[0]?.type).toEqual({
      blueId: 'type-root',
    });
    expect(contractItem?.summaryTriggerEvent?.type).toEqual({
      blueId: 'type-root',
    });
    expect(contractItem?.summaryEmittedEvents?.[0]?.type).toEqual({
      blueId: 'type-root',
    });

    const documentSnapshot = savedItems.find(
      item => item.PK === 'CONTRACT#contract-compact' && item.SK === 'DOCUMENT'
    );
    expect(documentSnapshot?.document?.type).toEqual({ blueId: 'type-root' });
  });
});
