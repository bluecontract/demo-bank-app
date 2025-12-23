import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DynamoPayNoteVerificationRepository,
  type SavePayNoteVerificationInput,
} from './DynamoPayNoteVerificationRepository';

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

const { PutCommand, GetCommand } = await import('@aws-sdk/lib-dynamodb');
const mockPutCommand = vi.mocked(PutCommand);
const mockGetCommand = vi.mocked(GetCommand);

const createRepository = () =>
  new DynamoPayNoteVerificationRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

const createInput = (
  overrides: Partial<SavePayNoteVerificationInput> = {}
) => ({
  userId: 'user-1',
  blueId: 'blue-123',
  validationScore: 8,
  explanation: 'Looks good',
  isSuccessful: true,
  validatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('DynamoPayNoteVerificationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveVerification', () => {
    it('persists verification with ttl when provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const repository = createRepository();
      await repository.saveVerification(
        createInput({ ttl: 1735689600 }) // 2024-12-31T00:00:00Z
      );

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          Item: expect.objectContaining({
            PK: 'USER#user-1',
            SK: 'PAYNOTE_VERIFICATION#blue-123',
            validationScore: 8,
            explanation: 'Looks good',
            isSuccessful: true,
            ttl: 1735689600,
          }),
        })
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('omits ttl when not provided', async () => {
      mockSend.mockResolvedValueOnce({});
      const repository = createRepository();
      await repository.saveVerification(createInput({ ttl: undefined }));

      const savedPayload = mockPutCommand.mock.calls.at(-1)?.[0];
      expect(savedPayload?.Item?.ttl).toBeUndefined();
    });
  });

  describe('getVerification', () => {
    it('returns verification when found', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          validationScore: 9,
          explanation: 'Approved',
          isSuccessful: true,
          validatedAt: '2024-01-02T12:00:00.000Z',
          ttl: 1735776000,
        },
      });
      const repository = createRepository();
      const result = await repository.getVerification({
        userId: 'user-1',
        blueId: 'blue-123',
      });

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          Key: {
            PK: 'USER#user-1',
            SK: 'PAYNOTE_VERIFICATION#blue-123',
          },
        })
      );
      expect(result).toEqual({
        userId: 'user-1',
        blueId: 'blue-123',
        validationScore: 9,
        explanation: 'Approved',
        isSuccessful: true,
        validatedAt: '2024-01-02T12:00:00.000Z',
        ttl: 1735776000,
      });
    });

    it('returns null when verification does not exist', async () => {
      mockSend.mockResolvedValueOnce({});
      const repository = createRepository();
      const result = await repository.getVerification({
        userId: 'user-1',
        blueId: 'missing',
      });

      expect(result).toBeNull();
    });
  });
});
