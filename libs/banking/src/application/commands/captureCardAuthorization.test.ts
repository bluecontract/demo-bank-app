import { describe, it, expect, vi } from 'vitest';
import { captureCardAuthorization } from './captureCardAuthorization';
import type { BankingRepository } from '../ports';
import type { HoldRepository } from '../HoldRepository';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import {
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyConflictError,
} from '../errors';
import { CARD_SETTLEMENT } from '../../domain/entities/Account';

const buildAccount = (overrides = {}) =>
  new Account({
    id: 'acc-1',
    accountNumber: '1234567890',
    name: 'Primary',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ledgerBalanceMinor: new Money(10_000),
    availableBalanceMinor: new Money(10_000),
    balanceVersion: 1,
    ...overrides,
  });

describe('captureCardAuthorization', () => {
  it('captures a pending authorization', async () => {
    const bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue('acc-1'),
      getAccountById: vi.fn().mockImplementation(async (id: string) => {
        if (id === CARD_SETTLEMENT.ACCOUNT_ID) {
          return buildAccount({
            id: CARD_SETTLEMENT.ACCOUNT_ID,
            accountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
            ownerUserId: 'SYSTEM',
          });
        }
        return buildAccount();
      }),
    } as unknown as BankingRepository;

    const holdRepository = {
      getHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 500,
        currency: 'USD',
        status: 'PENDING',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
      captureHold: vi.fn().mockResolvedValue({
        hold: { holdId: 'hold-1' },
        transactionId: 'txn-1',
        created: true,
      }),
    } as unknown as HoldRepository;

    const result = await captureCardAuthorization(
      { authorizationId: 'hold-1', amountMinor: 500, idempotencyKey: 'idem' },
      {
        bankingRepository,
        holdRepository,
        transactionIdGenerator: () => 'txn-1',
      }
    );

    expect(result.status).toBe('CAPTURED');
    expect(result.transactionId).toBe('txn-1');
    expect(holdRepository.captureHold).toHaveBeenCalledTimes(1);
  });

  it('returns idempotent capture when already captured', async () => {
    const bankingRepository = {
      getAccountIdByNumber: vi.fn(),
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;

    const holdRepository = {
      getHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 500,
        currency: 'USD',
        status: 'CAPTURED',
        createdAt: '2025-01-01T00:00:00.000Z',
        relatedTransactionId: 'txn-1',
      }),
    } as unknown as HoldRepository;

    const result = await captureCardAuthorization(
      { authorizationId: 'hold-1', amountMinor: 500, idempotencyKey: 'idem' },
      { bankingRepository, holdRepository }
    );

    expect(result.transactionId).toBe('txn-1');
  });

  it('throws when amount mismatches', async () => {
    const bankingRepository = {
      getAccountIdByNumber: vi.fn(),
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;

    const holdRepository = {
      getHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 500,
        currency: 'USD',
        status: 'PENDING',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    } as unknown as HoldRepository;

    await expect(
      captureCardAuthorization(
        { authorizationId: 'hold-1', amountMinor: 999, idempotencyKey: 'idem' },
        { bankingRepository, holdRepository }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('throws when hold is not found', async () => {
    const bankingRepository = {
      getAccountIdByNumber: vi.fn(),
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;
    const holdRepository = {
      getHold: vi.fn().mockResolvedValue(null),
    } as unknown as HoldRepository;

    await expect(
      captureCardAuthorization(
        { authorizationId: 'hold-1', amountMinor: 500, idempotencyKey: 'idem' },
        { bankingRepository, holdRepository }
      )
    ).rejects.toBeInstanceOf(HoldNotFoundError);
  });

  it('throws when hold is not pending', async () => {
    const bankingRepository = {
      getAccountIdByNumber: vi.fn(),
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;
    const holdRepository = {
      getHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 500,
        currency: 'USD',
        status: 'RELEASED',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    } as unknown as HoldRepository;

    await expect(
      captureCardAuthorization(
        { authorizationId: 'hold-1', amountMinor: 500, idempotencyKey: 'idem' },
        { bankingRepository, holdRepository }
      )
    ).rejects.toBeInstanceOf(HoldNotPendingError);
  });
});
