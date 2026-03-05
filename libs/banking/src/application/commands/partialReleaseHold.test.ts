import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialReleaseHold } from './partialReleaseHold';
import type { HoldRepository } from '../HoldRepository';
import type { BankingRepository } from '../ports';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { HoldNotFoundError, IdempotencyConflictError } from '../errors';
import { hashIdempotencyKey } from '../../domain/idempotency';

const BASE_ACCOUNT_PROPS = {
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking',
  ownerUserId: 'user-1',
  status: 'ACTIVE' as const,
  currency: 'USD' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(20_000),
  availableBalanceMinor: new Money(12_000),
  balanceVersion: 5,
};

const createAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => new Account({ ...BASE_ACCOUNT_PROPS, ...overrides });

const baseHold = {
  holdId: 'hold-123',
  payerAccountNumber: BASE_ACCOUNT_PROPS.accountNumber,
  amountMinor: 10_000,
  capturedAmountMinor: 0,
  currency: 'USD' as const,
  status: 'PENDING' as const,
  createdAt: '2024-01-02T00:00:00.000Z',
  description: 'Test hold',
};

const createDependencies = () => {
  const holdRepository: Partial<HoldRepository> = {
    getHold: vi.fn(),
    partialReleaseHold: vi.fn(),
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

describe('partialReleaseHold', () => {
  const command = {
    holdId: baseHold.holdId,
    userId: 'user-1',
    idempotencyKey: 'partial-release-idem-1',
    amountMinor: 3_000,
    reason: 'Customer requested partial release',
    payNoteDocumentId: 'paynote-doc-1',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('partially releases pending hold and keeps it pending', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.partialReleaseHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        created: true,
      })
    );

    const result = await partialReleaseHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
    });

    expect(result.status).toBe('PENDING');
    expect(result.amountMinor).toBe(7_000);

    const request = vi.mocked(holdRepositoryMock.partialReleaseHold!).mock
      .calls[0][0];
    expect(request.releaseAmountMinor).toBe(command.amountMinor);
    expect(request.expectedAmountMinor).toBe(baseHold.amountMinor);
    expect(request.expectedCapturedAmountMinor).toBe(0);
    expect(request.idempotencyKeyHash).toBe(
      hashIdempotencyKey(command.idempotencyKey)
    );
    expect(request.holdEvent.type).toBe('RELEASED');
    expect(request.holdEvent.reason).toBe(command.reason);
    expect(request.holdEvent.payNoteDocumentId).toBe(command.payNoteDocumentId);
  });

  it('marks hold as released when release amount consumes remaining reserve', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.partialReleaseHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        created: true,
      })
    );

    const result = await partialReleaseHold(
      {
        ...command,
        amountMinor: 10_000,
      },
      {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
      }
    );

    expect(result.status).toBe('RELEASED');
    expect(result.releasedAt).toBe('2024-01-03T12:00:00.000Z');
  });

  it('marks partially captured hold as captured when remaining reserve hits zero', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'PARTIALLY_CAPTURED' as const,
      capturedAmountMinor: 4_000,
    });
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.partialReleaseHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        created: true,
      })
    );

    const result = await partialReleaseHold(
      {
        ...command,
        amountMinor: 6_000,
      },
      {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
      }
    );

    expect(result.status).toBe('CAPTURED');
    expect(result.releasedAt).toBeUndefined();
    expect(result.amountMinor).toBe(4_000);
    expect(result.capturedAmountMinor).toBe(4_000);
  });

  it('throws when release amount exceeds remaining reserved amount', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'PARTIALLY_CAPTURED' as const,
      capturedAmountMinor: 3_000,
    });
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(
      partialReleaseHold(
        {
          ...command,
          amountMinor: 8_000,
        },
        {
          ...deps,
          holdRepository: holdRepositoryMock as HoldRepository,
          bankingRepository: bankingRepositoryMock as BankingRepository,
        }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('throws HoldNotFoundError when hold does not exist', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(null);

    await expect(
      partialReleaseHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotFoundError);
  });
});
