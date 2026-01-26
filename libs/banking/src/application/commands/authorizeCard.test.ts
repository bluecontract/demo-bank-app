import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorizeCard } from './authorizeCard';
import type { BankingRepository } from '../ports';
import type { CardRepository } from '../CardRepository';
import type { HoldRepository } from '../HoldRepository';
import type { CardHasher } from '../CardHasher';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { IdempotencyConflictError } from '../errors';

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

describe('authorizeCard', () => {
  let bankingRepository: BankingRepository;
  let cardRepository: CardRepository;
  let holdRepository: HoldRepository;
  let cardHasher: CardHasher;

  beforeEach(() => {
    bankingRepository = {
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;
    cardRepository = {
      getCardByPanHash: vi.fn(),
    } as unknown as CardRepository;
    holdRepository = {
      reserveHold: vi.fn(),
      ensureCardTransactionMapping: vi.fn().mockResolvedValue(undefined),
    } as unknown as HoldRepository;
    cardHasher = {
      hashPan: vi.fn().mockReturnValue('pan-hash'),
      hashCvc: vi.fn().mockReturnValue('cvc-hash'),
    };
  });

  it('approves a valid authorization', async () => {
    vi.mocked(cardRepository.getCardByPanHash).mockResolvedValue({
      cardId: 'card-1',
      accountId: 'acc-1',
      accountNumber: '1234567890',
      ownerUserId: 'user-1',
      cardholderName: 'Primary',
      pan: '1234560000000000',
      cvc: '123',
      panLast4: '4242',
      panHash: 'pan-hash',
      cvcHash: 'cvc-hash',
      expiryMonth: 12,
      expiryYear: 2099,
      status: 'ACTIVE',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(
      buildAccount()
    );
    vi.mocked(holdRepository.reserveHold).mockImplementation(async req => ({
      hold: req.hold,
      created: true,
    }));

    const result = await authorizeCard(
      {
        pan: '1234560000000000',
        expiryMonth: 12,
        expiryYear: 2099,
        cvc: '123',
        amountMinor: 500,
        currency: 'USD',
        merchant: { name: 'Demo Shop' },
        processorChargeId: 'ch_123',
        idempotencyKey: 'idem-1',
      },
      {
        bankingRepository,
        cardRepository,
        holdRepository,
        cardHasher,
        idGenerator: () => 'hold-1',
        clock: () => new Date('2025-01-01T00:00:00.000Z'),
      }
    );

    expect(result.status).toBe('APPROVED');
    if (result.status === 'APPROVED') {
      expect(result.hold.holdId).toBe('hold-1');
      expect(result.hold.cardId).toBe('card-1');
    }
  });

  it('declines when card is not found', async () => {
    vi.mocked(cardRepository.getCardByPanHash).mockResolvedValue(null);

    const result = await authorizeCard(
      {
        pan: '1234560000000000',
        expiryMonth: 12,
        expiryYear: 2099,
        cvc: '123',
        amountMinor: 500,
        currency: 'USD',
        merchant: { name: 'Demo Shop' },
        processorChargeId: 'ch_123',
        idempotencyKey: 'idem-1',
      },
      {
        bankingRepository,
        cardRepository,
        holdRepository,
        cardHasher,
      }
    );

    expect(result.status).toBe('DECLINED');
    if (result.status === 'DECLINED') {
      expect(result.declineCode).toBe('card_not_found');
    }
  });

  it('declines when CVC is invalid', async () => {
    vi.mocked(cardRepository.getCardByPanHash).mockResolvedValue({
      cardId: 'card-1',
      accountId: 'acc-1',
      accountNumber: '1234567890',
      ownerUserId: 'user-1',
      cardholderName: 'Primary',
      pan: '1234560000000000',
      cvc: '123',
      panLast4: '4242',
      panHash: 'pan-hash',
      cvcHash: 'expected',
      expiryMonth: 12,
      expiryYear: 2099,
      status: 'ACTIVE',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    vi.mocked(cardHasher.hashCvc).mockReturnValue('wrong');
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(
      buildAccount()
    );

    const result = await authorizeCard(
      {
        pan: '1234560000000000',
        expiryMonth: 12,
        expiryYear: 2099,
        cvc: '123',
        amountMinor: 500,
        currency: 'USD',
        merchant: { name: 'Demo Shop' },
        processorChargeId: 'ch_123',
        idempotencyKey: 'idem-1',
      },
      {
        bankingRepository,
        cardRepository,
        holdRepository,
        cardHasher,
      }
    );

    expect(result.status).toBe('DECLINED');
    if (result.status === 'DECLINED') {
      expect(result.declineCode).toBe('invalid_cvc');
    }
  });

  it('declines on insufficient funds', async () => {
    vi.mocked(cardRepository.getCardByPanHash).mockResolvedValue({
      cardId: 'card-1',
      accountId: 'acc-1',
      accountNumber: '1234567890',
      ownerUserId: 'user-1',
      cardholderName: 'Primary',
      pan: '1234560000000000',
      cvc: '123',
      panLast4: '4242',
      panHash: 'pan-hash',
      cvcHash: 'cvc-hash',
      expiryMonth: 12,
      expiryYear: 2099,
      status: 'ACTIVE',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(
      buildAccount({
        availableBalanceMinor: new Money(100),
      })
    );

    const result = await authorizeCard(
      {
        pan: '1234560000000000',
        expiryMonth: 12,
        expiryYear: 2099,
        cvc: '123',
        amountMinor: 500,
        currency: 'USD',
        merchant: { name: 'Demo Shop' },
        processorChargeId: 'ch_123',
        idempotencyKey: 'idem-1',
      },
      {
        bankingRepository,
        cardRepository,
        holdRepository,
        cardHasher,
      }
    );

    expect(result.status).toBe('DECLINED');
    if (result.status === 'DECLINED') {
      expect(result.declineCode).toBe('insufficient_funds');
    }
  });

  it('throws on idempotency conflict', async () => {
    vi.mocked(cardRepository.getCardByPanHash).mockResolvedValue({
      cardId: 'card-1',
      accountId: 'acc-1',
      accountNumber: '1234567890',
      ownerUserId: 'user-1',
      cardholderName: 'Primary',
      pan: '1234560000000000',
      cvc: '123',
      panLast4: '4242',
      panHash: 'pan-hash',
      cvcHash: 'cvc-hash',
      expiryMonth: 12,
      expiryYear: 2099,
      status: 'ACTIVE',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(
      buildAccount()
    );
    vi.mocked(holdRepository.reserveHold).mockResolvedValue({
      hold: {
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 999,
        currency: 'USD',
        status: 'PENDING',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      created: false,
    });

    await expect(
      authorizeCard(
        {
          pan: '1234560000000000',
          expiryMonth: 12,
          expiryYear: 2099,
          cvc: '123',
          amountMinor: 500,
          currency: 'USD',
          merchant: { name: 'Demo Shop' },
          processorChargeId: 'ch_123',
          idempotencyKey: 'idem-1',
        },
        {
          bankingRepository,
          cardRepository,
          holdRepository,
          cardHasher,
          idGenerator: () => 'hold-1',
          clock: () => new Date('2025-01-01T00:00:00.000Z'),
        }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
