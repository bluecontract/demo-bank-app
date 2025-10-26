import { describe, it, expect, beforeEach, vi } from 'vitest';
import { releaseHold } from './releaseHold';
import type { HoldRepository } from '../HoldRepository';
import type { BankingRepository } from '../ports';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import {
  HoldNotFoundError,
  HoldNotPendingError,
  ForbiddenError,
} from '../errors';

const BASE_ACCOUNT_PROPS = {
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking',
  ownerUserId: 'user-1',
  status: 'ACTIVE' as const,
  currency: 'USD' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(7_000),
  availableBalanceMinor: new Money(4_000),
  balanceVersion: 2,
};

const createAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => new Account({ ...BASE_ACCOUNT_PROPS, ...overrides });

const baseHold = {
  holdId: 'hold-123',
  payerAccountNumber: BASE_ACCOUNT_PROPS.accountNumber,
  amountMinor: 4_000,
  currency: 'USD' as const,
  status: 'PENDING' as const,
  createdAt: '2024-01-02T00:00:00.000Z',
  description: 'Test hold',
};

const createDependencies = () => {
  const holdRepository: Partial<HoldRepository> = {
    getHold: vi.fn(),
    releaseHold: vi.fn(),
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

describe('releaseHold', () => {
  const command = {
    holdId: baseHold.holdId,
    userId: 'user-1',
    idempotencyKey: 'idem-123',
    reason: 'User requested cancellation',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('releases hold successfully', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.releaseHold!).mockImplementation(
      async request => ({
        hold: request.hold,
        created: true,
      })
    );

    const releasedHold = await releaseHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
      bankingRepository: bankingRepositoryMock as BankingRepository,
    });

    expect(releasedHold.status).toBe('RELEASED');
    expect(releasedHold.releaseReason).toBe(command.reason);
    expect(releasedHold.releasedAt).toBe('2024-01-03T00:00:00.000Z');

    expect(holdRepositoryMock.releaseHold).toHaveBeenCalledTimes(1);
    const request = vi.mocked(holdRepositoryMock.releaseHold!).mock.calls[0][0];
    expect(request.amountMinor).toBe(baseHold.amountMinor);
    expect(request.accountId).toBe(account.id);
    expect(request.hold.status).toBe('RELEASED');
  });

  it('returns existing hold immediately when already released', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    const releasedHold = {
      ...baseHold,
      status: 'RELEASED' as const,
      releasedAt: '2024-01-02T05:00:00.000Z',
      releaseReason: 'User requested cancellation',
    };

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(releasedHold);

    const result = await releaseHold(command, {
      ...deps,
      holdRepository: holdRepositoryMock as HoldRepository,
    });

    expect(result).toEqual(releasedHold);
    expect(holdRepositoryMock.releaseHold).not.toHaveBeenCalled();
  });

  it('throws HoldNotFoundError when hold is missing', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(null);

    await expect(
      releaseHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotFoundError);
  });

  it('throws HoldNotPendingError when status is not pending', async () => {
    const { holdRepositoryMock, ...deps } = createDependencies();
    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue({
      ...baseHold,
      status: 'CAPTURED',
    });

    await expect(
      releaseHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
      })
    ).rejects.toBeInstanceOf(HoldNotPendingError);
  });

  it('throws ForbiddenError when user does not own payer account', async () => {
    const { holdRepositoryMock, bankingRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount({ ownerUserId: 'user-2' });

    vi.mocked(holdRepositoryMock.getHold!).mockResolvedValue(baseHold);
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(
      releaseHold(command, {
        ...deps,
        holdRepository: holdRepositoryMock as HoldRepository,
        bankingRepository: bankingRepositoryMock as BankingRepository,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
