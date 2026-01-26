import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureHold } from './captureHold';
import type { HoldRepository } from '../HoldRepository';
import type { BankingRepository } from '../ports';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import {
  HoldCounterpartyMismatchError,
  HoldCounterpartyRequiredError,
  HoldNotFoundError,
  HoldNotPendingError,
  ForbiddenError,
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
  amountMinor: 4_000,
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
    captureHold: vi.fn(),
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

describe('captureHold', () => {
  const command = {
    holdId: baseHold.holdId,
    userId: 'user-1',
    idempotencyKey: 'idem-321',
    counterpartyAccountNumber: baseHold.counterpartyAccountNumber,
    payNoteDocumentId: 'doc-capture',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('captures hold successfully', async () => {
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

    vi.mocked(holdRepositoryMock.captureHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        transactionId: request.transaction.id,
        created: true,
      })
    );

    const result = await captureHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
      clock: () => new Date('2024-01-05T00:00:00.000Z'),
      transactionIdGenerator: () => 'txn-789',
    });

    expect(result.status).toBe('CAPTURED');
    expect(result.relatedTransactionId).toBe('txn-789');
    expect(result.counterpartyAccountNumber).toBe(
      counterpartyAccount.accountNumber
    );

    expect(holdRepositoryMock.captureHold).toHaveBeenCalledTimes(1);
    const request = vi.mocked(holdRepositoryMock.captureHold!).mock.calls[0][0];
    expect(request.payerAccountId).toBe(payerAccount.id);
    expect(request.counterpartyAccountId).toBe(counterpartyAccount.id);
    expect(request.hold.status).toBe('CAPTURED');
    expect(request.hold.relatedTransactionId).toBe('txn-789');
    expect(request.holdEvent.at).toBe('2024-01-05T00:00:00.000Z');
    expect(request.holdEvent.transactionId).toBe('txn-789');
    expect(request.holdEvent.payNoteDocumentId).toBe(command.payNoteDocumentId);
    expect(request.transaction.id).toBe('txn-789');
    expect(request.transaction.originHoldId).toBe(baseHold.holdId);
    expect(request.transaction.payNoteDocumentId).toBe(
      command.payNoteDocumentId
    );
    expect(request.idempotencyKeyHash).toBe(
      hashIdempotencyKey(command.idempotencyKey)
    );
    expect(request.transaction.postings).toHaveLength(2);
    expect(
      request.transaction.postings.map(posting => posting.accountId).sort()
    ).toEqual([payerAccount.id, counterpartyAccount.id].sort());
  });

  it('throws when hold is missing', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(null);

    await expect(
      captureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotFoundError);
  });

  it('throws when hold is not pending', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'RELEASED',
    });

    await expect(
      captureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotPendingError);
  });

  it('throws when counterparty is missing', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      counterpartyAccountNumber: undefined,
    });

    await expect(
      captureHold(
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
      captureHold(
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

  it('throws ForbiddenError when payer account not owned by user', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const payerAccount = createAccount({ ownerUserId: 'user-2' });

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockImplementation(
      async accountNumber => {
        if (accountNumber === payerAccount.accountNumber) {
          return payerAccount.id;
        }
        if (accountNumber === COUNTERPARTY_ACCOUNT_PROPS.accountNumber) {
          return COUNTERPARTY_ACCOUNT_PROPS.id;
        }
        return null;
      }
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockImplementation(
      async accountId => {
        if (accountId === payerAccount.id) {
          return payerAccount;
        }
        if (accountId === COUNTERPARTY_ACCOUNT_PROPS.id) {
          return createCounterpartyAccount();
        }
        return null;
      }
    );

    await expect(
      captureHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns existing hold on idempotent retry', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    const capturedHold = {
      ...baseHold,
      status: 'CAPTURED' as const,
      relatedTransactionId: 'txn-existing',
    };

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(capturedHold);

    const result = await captureHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
    });

    expect(result).toEqual(capturedHold);
    expect(holdRepositoryMock.captureHold).not.toHaveBeenCalled();
  });
});
