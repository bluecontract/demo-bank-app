import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TransactWriteCommand,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoHoldRepository } from './DynamoHoldRepository';
import type { ReserveHoldRequest } from '../application/HoldRepository';
import { hashIdempotencyKey } from '../domain/idempotency';
import { buildHoldMetaItem, HOLD_ITEM_CONSTANTS } from './dynamo/holds/items';
import { InsufficientFundsError } from '../domain/errors';
import { OptimisticLockError, RepositoryError } from './repositoryErrors';

const TABLE_NAME = 'test-table';

const baseRequest = (): ReserveHoldRequest => {
  const idempotencyKey = 'idem-123';
  const hold = {
    holdId: 'hold-123',
    payerAccountNumber: '1234567890',
    counterpartyAccountNumber: '5555555555',
    amountMinor: 5_000,
    currency: 'USD' as const,
    status: 'PENDING' as const,
    description: 'Test hold',
    createdAt: '2024-01-02T00:00:00.000Z',
  };

  return {
    accountId: 'acc-123',
    accountBalanceVersion: 1,
    availableBalanceMinor: 10_000,
    amountMinor: hold.amountMinor,
    hold,
    holdEvent: {
      at: hold.createdAt,
      type: 'CREATED' as const,
      createdByUserId: 'user-1',
      idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
    },
    idempotencyKey,
    idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
    userId: 'user-1',
  };
};

const createRepository = () => {
  const send = vi.fn();
  const repository = new DynamoHoldRepository({
    tableName: TABLE_NAME,
    region: 'us-east-1',
    documentClient: { send } as any,
  });
  return { repository, send };
};

describe('DynamoHoldRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs reserve transact write successfully', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValue({});

    const request = baseRequest();
    const result = await repository.reserveHold(request);

    expect(result.created).toBe(true);
    expect(result.hold).toEqual(request.hold);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    const transactItems =
      (command as TransactWriteCommand).input.TransactItems ?? [];
    expect(transactItems).toHaveLength(4);
    expect(transactItems[0]?.Update?.UpdateExpression).toContain(
      'availableBalanceMinor = availableBalanceMinor - :amount'
    );
    expect(transactItems[1]?.Put?.Item?.holdId).toBe(request.hold.holdId);
    expect(transactItems[3]?.Put?.Item?.holdId).toBe(request.hold.holdId);
  });

  it('throws InsufficientFundsError when balance check fails', async () => {
    const { repository, send } = createRepository();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-1',
        attempts: 1,
        totalRetryDelay: 0,
      },
    });
    (error as TransactionCanceledException).CancellationReasons = [
      { Code: 'ConditionalCheckFailed' },
    ];
    send.mockImplementation(async command => {
      if (command instanceof TransactWriteCommand) {
        throw error;
      }
      if (command instanceof GetCommand) {
        return {
          Item: {
            availableBalanceMinor: 1_000,
            ledgerBalanceMinor: 1_000,
            version: 1,
          },
        };
      }
      throw new Error('Unexpected command');
    });

    await expect(repository.reserveHold(baseRequest())).rejects.toBeInstanceOf(
      InsufficientFundsError
    );
  });

  it('returns existing hold when idempotency record exists', async () => {
    const { repository, send } = createRepository();
    const request = baseRequest();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-2',
        attempts: 1,
        totalRetryDelay: 0,
      },
    });
    (error as TransactionCanceledException).CancellationReasons = [
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ];

    send.mockImplementation(async command => {
      if (command instanceof TransactWriteCommand) {
        throw error;
      }
      if (command instanceof GetCommand) {
        const projection = command.input.ProjectionExpression;
        if (projection === 'holdId') {
          return { Item: { holdId: request.hold.holdId } };
        }
        return { Item: buildHoldMetaItem(request.hold) };
      }
      throw new Error('Unexpected command');
    });

    const result = await repository.reserveHold(request);

    expect(result.created).toBe(false);
    expect(result.hold).toEqual(request.hold);
  });

  it('throws OptimisticLockError when balance version mismatches', async () => {
    const { repository, send } = createRepository();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-3',
        attempts: 1,
        totalRetryDelay: 0,
      },
    });
    (error as TransactionCanceledException).CancellationReasons = [
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ];
    send.mockImplementation(async command => {
      if (command instanceof TransactWriteCommand) {
        throw error;
      }
      if (command instanceof GetCommand) {
        return {
          Item: {
            availableBalanceMinor: baseRequest().amountMinor + 1_000,
            ledgerBalanceMinor: 10_000,
            version: 1,
          },
        };
      }
      throw new Error('Unexpected command');
    });

    await expect(repository.reserveHold(baseRequest())).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });

  it('throws RepositoryError on unexpected failures', async () => {
    const { repository, send } = createRepository();
    send.mockRejectedValue(new Error('boom'));

    await expect(repository.reserveHold(baseRequest())).rejects.toBeInstanceOf(
      RepositoryError
    );
  });

  it('persists hold metadata via putHoldMeta', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValue({});
    const hold = baseRequest().hold;

    await repository.putHoldMeta(hold);

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutCommand);
    expect((command as PutCommand).input.Item?.holdId).toEqual(hold.holdId);
  });

  it('retrieves hold metadata', async () => {
    const { repository, send } = createRepository();
    const request = baseRequest();
    send.mockResolvedValueOnce({ Item: buildHoldMetaItem(request.hold) });

    const hold = await repository.getHold(request.hold.holdId);

    expect(hold).toEqual(request.hold);
  });

  it('returns null when hold metadata is missing', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValueOnce({});

    const hold = await repository.getHold('missing');

    expect(hold).toBeNull();
  });

  it('lists pending holds ordered by createdAt desc', async () => {
    const { repository, send } = createRepository();
    const request = baseRequest();
    const second = {
      ...request.hold,
      holdId: 'hold-456',
      createdAt: '2024-01-03T00:00:00.000Z',
    };
    send.mockResolvedValueOnce({
      Items: [buildHoldMetaItem(second), buildHoldMetaItem(request.hold)],
      LastEvaluatedKey: {
        PK: `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.ACCOUNT}${request.hold.payerAccountNumber}`,
        SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
      },
    });

    const result = await repository.listPendingHoldsByAccountNumber(
      request.hold.payerAccountNumber,
      { limit: 10 }
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].holdId).toBe('hold-456');
    expect(result.hasMore).toBe(true);
    expect(result.nextToken).toBeDefined();
  });
});
