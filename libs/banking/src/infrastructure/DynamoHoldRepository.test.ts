import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TransactWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoHoldRepository } from './DynamoHoldRepository';
import type {
  ReserveHoldRequest,
  ReleaseHoldRequest,
  CaptureHoldRequest,
} from '../application/HoldRepository';
import { hashIdempotencyKey } from '../domain/idempotency';
import { buildHoldMetaItem, HOLD_ITEM_CONSTANTS } from './dynamo/holds/items';
import { InsufficientFundsError } from '../domain/errors';
import { OptimisticLockError, RepositoryError } from './repositoryErrors';
import { Transaction } from '../domain/entities/Transaction';
import { Posting } from '../domain/valueObjects/Posting';
import { Money } from '../domain/valueObjects/Money';

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

const baseReleaseRequest = (): ReleaseHoldRequest => {
  const idempotencyKey = 'release-idem-key';

  return {
    accountId: 'acc-123',
    accountBalanceVersion: 2,
    availableBalanceMinor: 5_000,
    amountMinor: 4_000,
    hold: {
      holdId: 'hold-release',
      payerAccountNumber: '1234567890',
      amountMinor: 4_000,
      currency: 'USD',
      status: 'RELEASED',
      description: 'Test hold release',
      createdAt: '2024-01-02T00:00:00.000Z',
      releasedAt: '2024-01-03T00:00:00.000Z',
      releaseReason: 'Customer request',
    },
    holdEvent: {
      at: '2024-01-03T00:00:00.000Z',
      type: 'RELEASED',
      reason: 'Customer request',
    },
    idempotencyKey,
    idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
    userId: 'user-1',
  };
};

const baseCaptureRequest = (): CaptureHoldRequest => {
  const idempotencyKey = 'capture-idem-key';
  const amountMinor = 4_000;
  const holdId = 'hold-capture';
  const payerAccountId = 'acc-123';
  const counterpartyAccountId = 'acc-456';
  const debitPosting = new Posting({
    accountId: payerAccountId,
    amount: new Money(amountMinor),
    side: 'DEBIT',
    accountNumber: '1234567890',
    counterpartyAccountNumber: '5555555555',
  });
  const creditPosting = new Posting({
    accountId: counterpartyAccountId,
    amount: new Money(amountMinor),
    side: 'CREDIT',
    accountNumber: '5555555555',
    counterpartyAccountNumber: '1234567890',
  });
  const transaction = Transaction.createWithId(
    [debitPosting, creditPosting],
    {
      idempotencyKey,
      description: 'Capture funds',
      originHoldId: holdId,
    },
    'txn-capture'
  );

  const hold = {
    holdId,
    payerAccountNumber: debitPosting.accountNumber,
    counterpartyAccountNumber: creditPosting.accountNumber,
    amountMinor,
    currency: 'USD' as const,
    status: 'CAPTURED' as const,
    description: 'Captured hold',
    createdAt: '2024-01-02T00:00:00.000Z',
    relatedTransactionId: transaction.id,
  };

  return {
    payerAccountId,
    payerAccountBalanceVersion: 3,
    counterpartyAccountId,
    counterpartyAccountBalanceVersion: 5,
    hold,
    holdEvent: {
      at: '2024-01-05T00:00:00.000Z',
      type: 'CAPTURED' as const,
      transactionId: transaction.id,
      counterpartyAccountNumber: hold.counterpartyAccountNumber!,
    },
    transaction,
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

  it('performs release transact write successfully', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValue({});

    const request = baseReleaseRequest();
    const result = await repository.releaseHold(request);

    expect(result.created).toBe(true);
    expect(result.hold).toEqual(request.hold);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    const transactItems =
      (command as TransactWriteCommand).input.TransactItems ?? [];
    expect(transactItems).toHaveLength(4);
    expect(transactItems[0]?.Update?.UpdateExpression).toContain(
      'availableBalanceMinor = availableBalanceMinor + :amount'
    );
    expect(transactItems[1]?.Update?.ConditionExpression).toContain(
      '#status = :pendingStatus'
    );
    expect(transactItems[3]?.Put?.Item?.command).toBe('RELEASE');
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
        if (projection && projection.includes('holdId')) {
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

  it('returns existing hold when release idempotency record exists', async () => {
    const { repository, send } = createRepository();
    const request = baseReleaseRequest();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-4',
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
        if (projection && projection.includes('holdId')) {
          return { Item: { holdId: request.hold.holdId } };
        }
        return { Item: buildHoldMetaItem(request.hold) };
      }
      throw new Error('Unexpected command');
    });

    const result = await repository.releaseHold(request);

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

  it('throws OptimisticLockError when release account update fails', async () => {
    const { repository, send } = createRepository();
    const request = baseReleaseRequest();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-5',
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
            ledgerBalanceMinor: 5_000,
            version: 2,
          },
        };
      }
      throw new Error('Unexpected command');
    });

    await expect(repository.releaseHold(request)).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });

  it('throws OptimisticLockError when release account version mismatches', async () => {
    const { repository, send } = createRepository();
    const request = baseReleaseRequest();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-6',
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
            availableBalanceMinor: request.availableBalanceMinor + 1_000,
            ledgerBalanceMinor: 10_000,
            version: request.accountBalanceVersion + 1,
          },
        };
      }
      throw new Error('Unexpected command');
    });

    await expect(repository.releaseHold(request)).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });

  it('throws OptimisticLockError when hold status update fails during release', async () => {
    const { repository, send } = createRepository();
    const request = baseReleaseRequest();
    const error = new TransactionCanceledException({
      message: 'Cancelled',
      $metadata: {
        httpStatusCode: 400,
        requestId: 'req-7',
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
            availableBalanceMinor: request.availableBalanceMinor,
            ledgerBalanceMinor: 10_000,
            version: request.accountBalanceVersion,
          },
        };
      }
      throw new Error('Unexpected command');
    });

    await expect(repository.releaseHold(request)).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });

  describe('captureHold', () => {
    it('performs capture transact write successfully', async () => {
      const { repository, send } = createRepository();
      send.mockResolvedValue({});

      const request = baseCaptureRequest();
      const result = await repository.captureHold(request);

      expect(result.created).toBe(true);
      expect(result.hold).toEqual(request.hold);
      expect(result.transactionId).toBe(request.transaction.id);

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(TransactWriteCommand);
      const items = (command as TransactWriteCommand).input.TransactItems ?? [];
      expect(items).toHaveLength(8);
      expect(items[0]?.Update?.UpdateExpression).toContain(
        'availableBalanceMinor = availableBalanceMinor + :payerAvailableDelta'
      );
      expect(items[1]?.Update?.UpdateExpression).toContain(
        'availableBalanceMinor = availableBalanceMinor + :counterpartyAvailableDelta'
      );
      expect(items[2]?.Update?.ConditionExpression).toContain(
        '#status = :pendingStatus'
      );
      expect(items[2]?.Update?.ConditionExpression).toContain(
        'attribute_not_exists(counterpartyAccountNumber)'
      );
      const transactionHeader = items
        .map(item => item.Put?.Item)
        .find(putItem => putItem?.SK === 'META');
      expect(transactionHeader?.transactionId).toBe(request.transaction.id);
      expect(transactionHeader?.originHoldId).toBe(request.hold.holdId);

      const idempotencyPut = items[items.length - 1]?.Put?.Item;
      expect(idempotencyPut?.command).toBe('CAPTURE');
      expect(idempotencyPut?.transactionId).toBe(request.transaction.id);
    });

    it('returns existing hold when capture idempotency record exists', async () => {
      const { repository, send } = createRepository();
      const request = baseCaptureRequest();
      const error = new TransactionCanceledException({
        message: 'Cancelled',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'req-8',
          attempts: 1,
          totalRetryDelay: 0,
        },
      });
      (error as TransactionCanceledException).CancellationReasons = [
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'None' },
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
          if (projection && projection.includes('holdId')) {
            return {
              Item: {
                holdId: request.hold.holdId,
                transactionId: request.transaction.id,
              },
            };
          }
          return { Item: buildHoldMetaItem(request.hold) };
        }
        throw new Error('Unexpected command');
      });

      const result = await repository.captureHold(request);

      expect(result.created).toBe(false);
      expect(result.hold).toEqual(request.hold);
      expect(result.transactionId).toBe(request.transaction.id);
    });

    it('throws InsufficientFundsError when capture payer account balance is too low', async () => {
      const { repository, send } = createRepository();
      const request = baseCaptureRequest();
      const error = new TransactionCanceledException({
        message: 'Cancelled',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'req-9',
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
              availableBalanceMinor: request.hold.amountMinor - 500,
              ledgerBalanceMinor: 10_000,
              version: request.payerAccountBalanceVersion,
            },
          };
        }
        throw new Error('Unexpected command');
      });

      await expect(repository.captureHold(request)).rejects.toBeInstanceOf(
        InsufficientFundsError
      );
    });

    it('throws OptimisticLockError when capture counterparty update fails', async () => {
      const { repository, send } = createRepository();
      const request = baseCaptureRequest();
      const error = new TransactionCanceledException({
        message: 'Cancelled',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'req-10',
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
        throw new Error('Unexpected command');
      });

      await expect(repository.captureHold(request)).rejects.toBeInstanceOf(
        OptimisticLockError
      );
    });

    it('throws OptimisticLockError when capture hold status update fails', async () => {
      const { repository, send } = createRepository();
      const request = baseCaptureRequest();
      const error = new TransactionCanceledException({
        message: 'Cancelled',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'req-11',
          attempts: 1,
          totalRetryDelay: 0,
        },
      });
      (error as TransactionCanceledException).CancellationReasons = [
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ];

      send.mockImplementation(async command => {
        if (command instanceof TransactWriteCommand) {
          throw error;
        }
        if (command instanceof GetCommand) {
          return {
            Item: buildHoldMetaItem({ ...request.hold, status: 'PENDING' }),
          };
        }
        throw new Error('Unexpected command');
      });

      await expect(repository.captureHold(request)).rejects.toBeInstanceOf(
        OptimisticLockError
      );
    });

    it('throws OptimisticLockError when capture posting write fails', async () => {
      const { repository, send } = createRepository();
      const request = baseCaptureRequest();
      const error = new TransactionCanceledException({
        message: 'Cancelled',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'req-12',
          attempts: 1,
          totalRetryDelay: 0,
        },
      });
      (error as TransactionCanceledException).CancellationReasons = [
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
        { Code: 'None' },
      ];

      send.mockImplementation(async command => {
        if (command instanceof TransactWriteCommand) {
          throw error;
        }
        throw new Error('Unexpected command');
      });

      await expect(repository.captureHold(request)).rejects.toBeInstanceOf(
        OptimisticLockError
      );
    });
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

  it('queries HOLD_GSI1 with pending prefix and descending order', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValueOnce({ Items: [] });

    await repository.listPendingHoldsByAccountNumber('1234567890', {
      limit: 5,
    });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    const input = (command as QueryCommand).input;
    expect(input.IndexName).toBe(HOLD_ITEM_CONSTANTS.GSI_NAMES.HOLD_GSI1);
    expect(input.ExpressionAttributeValues?.[':skPrefix']).toBe('PENDING#');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(5);
  });

  it('decodes pagination token and sets ExclusiveStartKey', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValueOnce({ Items: [] });
    const exclusiveStartKey = {
      PK: 'HOLD#hold-999',
      SK: 'META',
      HOLD_GSI1PK: 'ACCOUNT#1234567890',
      HOLD_GSI1SK: 'PENDING#2024-01-01T00:00:00.000Z#hold-999',
    };
    const token = Buffer.from(
      JSON.stringify(exclusiveStartKey),
      'utf8'
    ).toString('base64');

    await repository.listPendingHoldsByAccountNumber('1234567890', {
      nextToken: token,
    });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect((command as QueryCommand).input.ExclusiveStartKey).toEqual(
      exclusiveStartKey
    );
  });

  it('returns empty pagination metadata when DynamoDB indicates no more items', async () => {
    const { repository, send } = createRepository();
    send.mockResolvedValueOnce({ Items: [] });

    const result = await repository.listPendingHoldsByAccountNumber(
      '1234567890'
    );

    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextToken).toBeUndefined();
  });

  it('throws RepositoryError when pagination token cannot be decoded', async () => {
    const { repository } = createRepository();

    await expect(
      repository.listPendingHoldsByAccountNumber('1234567890', {
        nextToken: 'not-base64',
      })
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});
