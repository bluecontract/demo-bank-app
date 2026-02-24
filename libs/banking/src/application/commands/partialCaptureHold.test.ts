import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { partialCaptureHold } from './partialCaptureHold';
import type { HoldRepository } from '../HoldRepository';
import type { BankingRepository } from '../ports';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import {
  HoldCaptureDisabledError,
  HoldCounterpartyMismatchError,
  HoldCounterpartyRequiredError,
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyConflictError,
} from '../errors';
import { hashIdempotencyKey } from '../../domain/idempotency';

const BASE_ACCOUNT_PROPS = {
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking',
  ownerUserId: 'user-1',
  status: 'ACTIVE' as const,
  currency: 'USD' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(10_000),
  availableBalanceMinor: new Money(9_000),
  balanceVersion: 3,
};

const COUNTERPARTY_ACCOUNT_PROPS = {
  id: 'acc-456',
  accountNumber: '0987654321',
  name: 'Savings',
  ownerUserId: 'user-2',
  status: 'ACTIVE' as const,
  currency: 'USD' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(20_000),
  availableBalanceMinor: new Money(20_000),
  balanceVersion: 5,
};

const baseHold = {
  holdId: 'hold-123',
  payerAccountNumber: BASE_ACCOUNT_PROPS.accountNumber,
  counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_PROPS.accountNumber,
  amountMinor: 10_000,
  capturedAmountMinor: 0,
  currency: 'USD' as const,
  status: 'PENDING' as const,
  description: 'Capture funds',
  createdAt: '2024-01-02T00:00:00.000Z',
};

const createAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => new Account({ ...BASE_ACCOUNT_PROPS, ...overrides });

const createCounterpartyAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => new Account({ ...COUNTERPARTY_ACCOUNT_PROPS, ...overrides });

const createDependencies = () => {
  const holdRepository: Partial<HoldRepository> = {
    getHold: vi.fn(),
    partialCaptureHold: vi.fn(),
  };

  const bankingRepository: Partial<BankingRepository> = {
    getAccountIdByNumber: vi.fn(),
    getAccountById: vi.fn(),
  };

  return {
    holdRepository: holdRepository as HoldRepository,
    bankingRepository: bankingRepository as BankingRepository,
    holdRepositoryMock: holdRepository,
    bankingRepositoryMock: bankingRepository,
  };
};

describe('partialCaptureHold', () => {
  const command = {
    holdId: baseHold.holdId,
    userId: 'user-1',
    idempotencyKey: 'idem-321',
    amountMinor: 4_000,
    counterpartyAccountNumber: baseHold.counterpartyAccountNumber,
    payNoteDocumentId: 'doc-partial',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('partially captures a hold successfully', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount();
    const counterpartyAccount = createCounterpartyAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === counterpartyAccount.accountNumber) {
          return counterpartyAccount.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === counterpartyAccount.id) {
          return counterpartyAccount;
        }
        return null;
      }
    );
    vi.mocked(holdRepositoryMock.partialCaptureHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        transactionId: request.transaction.id,
        created: true,
      })
    );

    const result = await partialCaptureHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
      clock: () => new Date('2024-01-05T00:00:00.000Z'),
      transactionIdGenerator: () => 'txn-789',
    });

    expect(result.hold.status).toBe('PARTIALLY_CAPTURED');
    expect(result.hold.capturedAmountMinor).toBe(4_000);
    expect(result.transactionId).toBe('txn-789');

    const request = vi.mocked(holdRepositoryMock.partialCaptureHold!).mock
      .calls[0][0];
    expect(request.captureAmountMinor).toBe(command.amountMinor);
    expect(request.holdEvent.type).toBe('CAPTURED_PARTIAL');
    if (request.holdEvent.type !== 'CAPTURED_PARTIAL') {
      throw new Error('Expected CAPTURED_PARTIAL hold event');
    }
    expect(request.holdEvent.amountMinor).toBe(command.amountMinor);
    expect(request.holdEvent.remainingAmountMinor).toBe(6_000);
    expect(request.idempotencyKeyHash).toBe(
      hashIdempotencyKey(command.idempotencyKey)
    );
  });

  it('marks hold captured when remaining amount hits zero', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount();
    const counterpartyAccount = createCounterpartyAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'PARTIALLY_CAPTURED',
      capturedAmountMinor: 6_000,
    });
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === counterpartyAccount.accountNumber) {
          return counterpartyAccount.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === counterpartyAccount.id) {
          return counterpartyAccount;
        }
        return null;
      }
    );
    vi.mocked(holdRepositoryMock.partialCaptureHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        transactionId: request.transaction.id,
        created: true,
      })
    );

    const result = await partialCaptureHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
      transactionIdGenerator: () => 'txn-final',
    });

    expect(result.hold.status).toBe('CAPTURED');
    expect(result.hold.capturedAmountMinor).toBe(10_000);

    const request = vi.mocked(holdRepositoryMock.partialCaptureHold!).mock
      .calls[0][0];
    expect(request.holdEvent.type).toBe('CAPTURED');
    expect(request.holdEvent.transactionId).toBe('txn-final');
    if (request.holdEvent.type !== 'CAPTURED') {
      throw new Error('Expected CAPTURED hold event');
    }
    expect(request.holdEvent.amountMinor).toBe(command.amountMinor);
    expect(request.holdEvent.remainingAmountMinor).toBe(0);
  });

  it('retries on optimistic lock and succeeds with the same idempotency key', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount();
    const counterpartyAccount = createCounterpartyAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === counterpartyAccount.accountNumber) {
          return counterpartyAccount.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === counterpartyAccount.id) {
          return counterpartyAccount;
        }
        return null;
      }
    );

    const optimisticError = Object.assign(
      new Error(
        `Optimistic lock failed for hold_capture_partial_${baseHold.holdId}`
      ),
      { code: 'OPTIMISTIC_LOCK_ERROR' }
    );

    vi.mocked(holdRepositoryMock.partialCaptureHold!)
      .mockRejectedValueOnce(optimisticError)
      .mockImplementation(async request => ({
        hold: request.hold,
        transactionId: request.transaction.id,
        created: true,
      }));

    const result = await partialCaptureHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
      transactionIdGenerator: () => 'txn-retry',
    });

    expect(result.hold.status).toBe('PARTIALLY_CAPTURED');
    expect(holdRepositoryMock.partialCaptureHold).toHaveBeenCalledTimes(2);

    const firstRequest = vi.mocked(holdRepositoryMock.partialCaptureHold!).mock
      .calls[0][0];
    const secondRequest = vi.mocked(holdRepositoryMock.partialCaptureHold!).mock
      .calls[1][0];

    expect(firstRequest.idempotencyKey).toBe(command.idempotencyKey);
    expect(secondRequest.idempotencyKey).toBe(command.idempotencyKey);
    expect(firstRequest.captureAmountMinor).toBe(command.amountMinor);
    expect(secondRequest.captureAmountMinor).toBe(command.amountMinor);
  });

  it('throws after exhausting optimistic lock retry attempts', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount();
    const counterpartyAccount = createCounterpartyAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === counterpartyAccount.accountNumber) {
          return counterpartyAccount.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === counterpartyAccount.id) {
          return counterpartyAccount;
        }
        return null;
      }
    );

    const optimisticError = Object.assign(
      new Error(
        `Optimistic lock failed for hold_capture_partial_${baseHold.holdId}`
      ),
      { code: 'OPTIMISTIC_LOCK_ERROR' }
    );

    vi.mocked(holdRepositoryMock.partialCaptureHold!).mockRejectedValue(
      optimisticError
    );

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
        transactionIdGenerator: () => 'txn-retry-exhausted',
      })
    ).rejects.toBe(optimisticError);

    expect(holdRepositoryMock.partialCaptureHold).toHaveBeenCalledTimes(3);
  });

  it('does not retry when repository error is not optimistic lock conflict', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount();
    const counterpartyAccount = createCounterpartyAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === counterpartyAccount.accountNumber) {
          return counterpartyAccount.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === counterpartyAccount.id) {
          return counterpartyAccount;
        }
        return null;
      }
    );

    const unexpectedRepositoryError = Object.assign(
      new Error('Repository unavailable'),
      { code: 'DATABASE_ERROR' }
    );
    vi.mocked(holdRepositoryMock.partialCaptureHold!).mockRejectedValue(
      unexpectedRepositoryError
    );

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
      })
    ).rejects.toBe(unexpectedRepositoryError);

    expect(holdRepositoryMock.partialCaptureHold).toHaveBeenCalledTimes(1);
  });

  it('throws when hold is missing', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(null);

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotFoundError);
  });

  it('throws when hold status is not capturable', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'RELEASED',
    });

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotPendingError);
  });

  it('throws when hold is already captured', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'CAPTURED',
      capturedAmountMinor: 10_000,
    });

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotPendingError);
  });

  it('throws when capture amount exceeds remaining', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'PARTIALLY_CAPTURED',
      capturedAmountMinor: 9_000,
    });

    await expect(
      partialCaptureHold(
        { ...command, amountMinor: 2_000 },
        {
          ...deps,
          holdRepository: holdRepositoryMock as HoldRepository,
        }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('throws when counterparty is missing', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      counterpartyAccountNumber: undefined,
    });

    await expect(
      partialCaptureHold(
        { ...command, counterpartyAccountNumber: undefined },
        {
          ...deps,
          holdRepository: holdRepositoryMock as HoldRepository,
        }
      )
    ).rejects.toBeInstanceOf(HoldCounterpartyRequiredError);
  });

  it('throws when counterparty mismatch occurs', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);

    await expect(
      partialCaptureHold(
        {
          ...command,
          counterpartyAccountNumber: '1111111111',
        },
        {
          ...deps,
          holdRepository: holdRepositoryMock as HoldRepository,
        }
      )
    ).rejects.toBeInstanceOf(HoldCounterpartyMismatchError);
  });

  it('throws when capture is disabled', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      captureDisabled: true,
    });

    await expect(
      partialCaptureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldCaptureDisabledError);
  });
});
