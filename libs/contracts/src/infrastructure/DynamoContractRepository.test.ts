import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);

const createRepository = () =>
  new DynamoContractRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

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
});
