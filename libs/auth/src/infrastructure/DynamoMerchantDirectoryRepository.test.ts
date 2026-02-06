import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoMerchantDirectoryRepository } from './DynamoMerchantDirectoryRepository';
import { MerchantDirectoryOwnershipError } from './errors';

const mockSend = vi.fn();
const mockDynamoDBDocumentClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  BatchGetCommand: vi.fn(),
}));

const { PutCommand, UpdateCommand, BatchGetCommand } = await import(
  '@aws-sdk/lib-dynamodb'
);
const mockPutCommand = vi.mocked(PutCommand);
const mockUpdateCommand = vi.mocked(UpdateCommand);
const mockBatchGetCommand = vi.mocked(BatchGetCommand);

describe('DynamoMerchantDirectoryRepository', () => {
  let repository: DynamoMerchantDirectoryRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DynamoMerchantDirectoryRepository({
      tableName: 'auth-table',
      region: 'us-east-1',
    });
  });

  it('creates a merchant profile when none exists', async () => {
    mockSend.mockResolvedValueOnce({});

    await repository.upsertMerchantProfile({
      merchantId: 'merchant-1',
      name: 'Blue Appliances',
      logoUrl: 'data:image/png;base64,abc',
      ownerUserId: 'user-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockPutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'auth-table',
        ConditionExpression: 'attribute_not_exists(PK)',
        Item: expect.objectContaining({
          PK: 'MERCHANT#merchant-1',
          SK: 'PROFILE',
          ownerUserId: 'user-1',
          name: 'Blue Appliances',
        }),
      })
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('updates a merchant profile owned by the same user', async () => {
    const conditionalError = Object.assign(new Error('conditional failed'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(conditionalError);
    mockSend.mockResolvedValueOnce({});

    await repository.upsertMerchantProfile({
      merchantId: 'merchant-1',
      name: 'Blue Appliances',
      logoUrl: 'data:image/png;base64,updated',
      ownerUserId: 'user-1',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });

    expect(mockPutCommand).toHaveBeenCalledTimes(1);
    expect(mockUpdateCommand).toHaveBeenCalledTimes(1);
    expect(mockUpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'auth-table',
        ConditionExpression: 'ownerUserId = :ownerUserId',
        UpdateExpression: expect.stringContaining('#name'),
      })
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('throws when the merchant id is owned by another user', async () => {
    const conditionalError = Object.assign(new Error('conditional failed'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(conditionalError);
    mockSend.mockRejectedValueOnce(conditionalError);

    await expect(
      repository.upsertMerchantProfile({
        merchantId: 'merchant-1',
        name: 'Blue Appliances',
        ownerUserId: 'user-1',
        updatedAt: '2024-01-02T00:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(MerchantDirectoryOwnershipError);
  });

  it('returns merchant profiles for batch lookup', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'auth-table': [
          {
            PK: 'MERCHANT#merchant-1',
            SK: 'PROFILE',
            entityType: 'MERCHANT_PROFILE',
            merchantId: 'merchant-1',
            name: 'Blue Appliances',
            logoUrl: 'data:image/png;base64,abc',
            ownerUserId: 'user-1',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    const result = await repository.getMerchantsByIds([
      'merchant-1',
      'merchant-1',
    ]);

    expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        merchantId: 'merchant-1',
        name: 'Blue Appliances',
        logoUrl: 'data:image/png;base64,abc',
        ownerUserId: 'user-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
  });
});
