import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoPayNoteRepository } from './DynamoPayNoteRepository';

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
}));

const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);

const createRepository = () =>
  new DynamoPayNoteRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

describe('DynamoPayNoteRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists merchantId when saving paynotes', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-1',
      sessionIds: ['session-1'],
      merchantId: 'merchant-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const savedItems = mockPutCommand.mock.calls
      .map(call => call[0].Item)
      .filter((item): item is { PK: string; merchantId?: string } =>
        Boolean(item)
      );
    const payNoteItem = savedItems.find(
      item => item.PK === 'PAYNOTE#paynote-doc-1'
    );

    expect(payNoteItem?.merchantId).toBe('merchant-1');
  });

  it('maps merchantId on get', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'PAYNOTE#paynote-doc-1',
        SK: 'META',
        entityType: 'PAYNOTE',
        payNoteDocumentId: 'paynote-doc-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    });
    const repository = createRepository();

    const result = await repository.getPayNote('paynote-doc-1');

    expect(result?.merchantId).toBe('merchant-1');
  });
});
