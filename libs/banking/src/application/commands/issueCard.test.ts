import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueCard } from './issueCard';
import type { BankingRepository } from '../ports';
import type { CardRepository } from '../CardRepository';
import type { CardHasher } from '../CardHasher';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import {
  AccountNotFoundError,
  CardIssuanceError,
  CardPanCollisionError,
  ForbiddenError,
} from '../errors';

const buildAccount = (overrides = {}) =>
  new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    name: 'Primary',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ledgerBalanceMinor: new Money(0),
    availableBalanceMinor: new Money(0),
    balanceVersion: 0,
    ...overrides,
  });

describe('issueCard', () => {
  let bankingRepository: BankingRepository;
  let cardRepository: CardRepository;
  let cardHasher: CardHasher;

  beforeEach(() => {
    bankingRepository = {
      getAccountById: vi.fn(),
    } as unknown as BankingRepository;
    cardRepository = {
      createCard: vi.fn(),
    } as unknown as CardRepository;
    cardHasher = {
      hashPan: vi.fn().mockReturnValue('pan-hash'),
      hashCvc: vi.fn().mockReturnValue('cvc-hash'),
    };
  });

  it('issues a card for an owned account', async () => {
    const account = buildAccount();
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(cardRepository.createCard).mockResolvedValue(undefined);

    const result = await issueCard(
      { userId: 'user-1', accountId: account.id, isTest: true },
      {
        bankingRepository,
        cardRepository,
        cardHasher,
        binPrefix: '123456',
        idGenerator: () => 'card-1',
        panGenerator: () => '1234560000000000',
        cvcGenerator: () => '999',
        clock: () => new Date('2025-01-01T00:00:00.000Z'),
      }
    );

    expect(result.pan).toBe('1234560000000000');
    expect(result.cvc).toBe('999');
    expect(result.card.cardId).toBe('card-1');
    expect(result.card.panLast4).toBe('0000');
    expect(result.card.panHash).toBe('pan-hash');
    expect(result.card.cvcHash).toBe('cvc-hash');
    expect(cardRepository.createCard).toHaveBeenCalledTimes(1);
  });

  it('retries on PAN collision and succeeds', async () => {
    const account = buildAccount();
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(cardRepository.createCard)
      .mockRejectedValueOnce(new CardPanCollisionError('pan-hash'))
      .mockResolvedValueOnce(undefined);

    const result = await issueCard(
      { userId: 'user-1', accountId: account.id },
      {
        bankingRepository,
        cardRepository,
        cardHasher,
        binPrefix: '123456',
        idGenerator: () => 'card-2',
        panGenerator: () => '1234561111111111',
        cvcGenerator: () => '123',
        clock: () => new Date('2025-01-01T00:00:00.000Z'),
      }
    );

    expect(result.card.cardId).toBe('card-2');
    expect(cardRepository.createCard).toHaveBeenCalledTimes(2);
  });

  it('throws when account is missing', async () => {
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(null);

    await expect(
      issueCard(
        { userId: 'user-1', accountId: 'missing' },
        {
          bankingRepository,
          cardRepository,
          cardHasher,
          binPrefix: '123456',
        }
      )
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('throws when account is not owned', async () => {
    const account = buildAccount({ ownerUserId: 'other-user' });
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(account);

    await expect(
      issueCard(
        { userId: 'user-1', accountId: account.id },
        {
          bankingRepository,
          cardRepository,
          cardHasher,
          binPrefix: '123456',
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws after retry exhaustion', async () => {
    const account = buildAccount();
    vi.mocked(bankingRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(cardRepository.createCard).mockRejectedValue(
      new CardPanCollisionError('pan-hash')
    );

    await expect(
      issueCard(
        { userId: 'user-1', accountId: account.id },
        {
          bankingRepository,
          cardRepository,
          cardHasher,
          binPrefix: '123456',
          panGenerator: () => '1234562222222222',
          cvcGenerator: () => '555',
        }
      )
    ).rejects.toBeInstanceOf(CardIssuanceError);
  });
});
