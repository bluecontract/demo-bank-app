import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamoBootstrapContextRepository } from './DynamoBootstrapContextRepository';

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
  GetCommand: vi.fn(payload => payload),
  PutCommand: vi.fn(payload => payload),
}));

const { GetCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
const mockGetCommand = vi.mocked(GetCommand);
const mockPutCommand = vi.mocked(PutCommand);

const createRepository = () =>
  new DynamoBootstrapContextRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

describe('DynamoBootstrapContextRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when bootstrap context does not exist', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    const result = await repository.getContextBySessionId(
      'bootstrap-session-1'
    );

    expect(result).toBeNull();
    expect(mockGetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: {
          PK: 'BOOTSTRAP#bootstrap-session-1',
          SK: 'META',
        },
      })
    );
  });

  it('maps all optional fields on get', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'BOOTSTRAP#bootstrap-session-1',
        SK: 'META',
        entityType: 'BOOTSTRAP_CONTEXT',
        bootstrapSessionId: 'bootstrap-session-1',
        merchantId: 'merchant-1',
        accountNumber: '7427566001',
        userId: 'user-1',
        holdId: 'hold-1',
        transactionId: 'txn-1',
        payerAccountNumber: '7427566001',
        payeeAccountNumber: '9559276001',
        customerChannelKey: 'payerChannel',
        requestingSessionId: 'requesting-session-1',
        requestId: 'bootstrap-request-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const repository = createRepository();

    const result = await repository.getContextBySessionId(
      'bootstrap-session-1'
    );

    expect(result).toEqual({
      bootstrapSessionId: 'bootstrap-session-1',
      merchantId: 'merchant-1',
      accountNumber: '7427566001',
      userId: 'user-1',
      holdId: 'hold-1',
      transactionId: 'txn-1',
      payerAccountNumber: '7427566001',
      payeeAccountNumber: '9559276001',
      customerChannelKey: 'payerChannel',
      requestingSessionId: 'requesting-session-1',
      requestId: 'bootstrap-request-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('does not include optional fields in put when omitted', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.saveContext({
      bootstrapSessionId: 'bootstrap-session-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const putPayload = mockPutCommand.mock.calls[0]?.[0];
    expect(putPayload?.Item).toEqual({
      PK: 'BOOTSTRAP#bootstrap-session-1',
      SK: 'META',
      entityType: 'BOOTSTRAP_CONTEXT',
      bootstrapSessionId: 'bootstrap-session-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(putPayload?.Item).not.toHaveProperty('merchantId');
    expect(putPayload?.Item).not.toHaveProperty('accountNumber');
    expect(putPayload?.Item).not.toHaveProperty('userId');
    expect(putPayload?.Item).not.toHaveProperty('holdId');
    expect(putPayload?.Item).not.toHaveProperty('transactionId');
    expect(putPayload?.Item).not.toHaveProperty('payerAccountNumber');
    expect(putPayload?.Item).not.toHaveProperty('payeeAccountNumber');
    expect(putPayload?.Item).not.toHaveProperty('customerChannelKey');
    expect(putPayload?.Item).not.toHaveProperty('requestingSessionId');
    expect(putPayload?.Item).not.toHaveProperty('requestId');
  });

  it('persists optional fields in put when provided', async () => {
    mockSend.mockResolvedValueOnce({});
    const repository = createRepository();

    await repository.saveContext({
      bootstrapSessionId: 'bootstrap-session-1',
      merchantId: 'merchant-1',
      accountNumber: '7427566001',
      userId: 'user-1',
      holdId: 'hold-1',
      transactionId: 'txn-1',
      payerAccountNumber: '7427566001',
      payeeAccountNumber: '9559276001',
      customerChannelKey: 'payerChannel',
      requestingSessionId: 'requesting-session-1',
      requestId: 'bootstrap-request-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const putPayload = mockPutCommand.mock.calls[0]?.[0];
    expect(putPayload?.Item).toEqual({
      PK: 'BOOTSTRAP#bootstrap-session-1',
      SK: 'META',
      entityType: 'BOOTSTRAP_CONTEXT',
      bootstrapSessionId: 'bootstrap-session-1',
      merchantId: 'merchant-1',
      accountNumber: '7427566001',
      userId: 'user-1',
      holdId: 'hold-1',
      transactionId: 'txn-1',
      payerAccountNumber: '7427566001',
      payeeAccountNumber: '9559276001',
      customerChannelKey: 'payerChannel',
      requestingSessionId: 'requesting-session-1',
      requestId: 'bootstrap-request-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });
});
