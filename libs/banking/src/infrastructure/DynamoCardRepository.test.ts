import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoCardRepository } from './DynamoCardRepository';
import { CardPanCollisionError } from '../application/errors';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

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
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  TransactWriteCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@aws-sdk/client-dynamodb')
  >();
  return {
    ...actual,
    TransactionCanceledException: actual.TransactionCanceledException,
  };
});

const { GetCommand, QueryCommand, TransactWriteCommand } = await import(
  '@aws-sdk/lib-dynamodb'
);
const mockGetCommand = vi.mocked(GetCommand);
const mockQueryCommand = vi.mocked(QueryCommand);
const mockTransactWriteCommand = vi.mocked(TransactWriteCommand);

const createCard = (overrides = {}) => ({
  cardId: 'card-1',
  accountId: 'acc-1',
  accountNumber: '1234567890',
  ownerUserId: 'user-1',
  cardholderName: 'Primary',
  pan: '1234567890124242',
  cvc: '123',
  panLast4: '4242',
  panHash: 'pan-hash',
  cvcHash: 'cvc-hash',
  expiryMonth: 12,
  expiryYear: 2030,
  status: 'ACTIVE' as const,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('DynamoCardRepository', () => {
  let repository: DynamoCardRepository;

  beforeEach(() => {
    mockSend.mockReset();
    repository = new DynamoCardRepository({
      tableName: 'BankTable',
      region: 'eu-west-1',
    });
  });

  it('creates a card with meta, lookup, and account index items', async () => {
    const card = createCard({ isTest: true });
    mockSend.mockResolvedValueOnce({});

    await repository.createCard(card);

    expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
    const transactItems =
      mockTransactWriteCommand.mock.calls[0][0].TransactItems;
    expect(transactItems).toHaveLength(3);
    expect(transactItems?.[0]?.Put?.Item?.PK).toBe('CARD#card-1');
    expect(transactItems?.[1]?.Put?.Item?.PK).toBe('CARD_PAN#pan-hash');
    expect(transactItems?.[2]?.Put?.Item?.PK).toBe('ACCOUNT#acc-1');
    expect(transactItems?.[0]?.Put?.Item?.ttl).toBeGreaterThan(0);
  });

  it('throws CardPanCollisionError on PAN lookup conflict', async () => {
    const card = createCard();
    const error = new TransactionCanceledException({
      message: 'Transaction cancelled',
      CancellationReasons: [{}, { Code: 'ConditionalCheckFailed' }, {}],
      $metadata: {},
    });
    mockSend.mockRejectedValueOnce(error);

    await expect(repository.createCard(card)).rejects.toBeInstanceOf(
      CardPanCollisionError
    );
  });

  it('gets a card by id', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        cardId: 'card-1',
        accountId: 'acc-1',
        accountNumber: '1234567890',
        ownerUserId: 'user-1',
        cardholderName: 'Primary',
        pan: '1234567890124242',
        cvc: '123',
        panLast4: '4242',
        panHash: 'pan-hash',
        cvcHash: 'cvc-hash',
        expiryMonth: 12,
        expiryYear: 2030,
        status: 'ACTIVE',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const card = await repository.getCardById('card-1');

    expect(mockGetCommand).toHaveBeenCalledTimes(1);
    expect(card?.cardId).toBe('card-1');
  });

  it('gets a card by pan hash', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          cardId: 'card-1',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          cardId: 'card-1',
          accountId: 'acc-1',
          accountNumber: '1234567890',
          ownerUserId: 'user-1',
          cardholderName: 'Primary',
          pan: '1234567890124242',
          cvc: '123',
          panLast4: '4242',
          panHash: 'pan-hash',
          cvcHash: 'cvc-hash',
          expiryMonth: 12,
          expiryYear: 2030,
          status: 'ACTIVE',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      });

    const card = await repository.getCardByPanHash('pan-hash');

    expect(card?.cardId).toBe('card-1');
  });

  it('lists cards by account id', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          cardId: 'card-1',
          accountId: 'acc-1',
          accountNumber: '1234567890',
          cardholderName: 'Primary',
          panLast4: '4242',
          expiryMonth: 12,
          expiryYear: 2030,
          status: 'ACTIVE',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await repository.listCardsByAccountId('acc-1');

    expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].cardId).toBe('card-1');
  });
});
