import { describe, it, expect, vi } from 'vitest';
import { listCards } from './listCards';
import type { BankingRepository } from '../ports';
import type { CardRepository } from '../CardRepository';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { AccountNotFoundError, ForbiddenError } from '../errors';

const buildAccount = (overrides = {}) =>
  new Account({
    id: 'acc-1',
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

describe('listCards', () => {
  it('lists cards for a specific account', async () => {
    const bankingRepository = {
      getAccountById: vi.fn().mockResolvedValue(buildAccount()),
    } as unknown as BankingRepository;
    const cardRepository = {
      listCardsByAccountId: vi.fn().mockResolvedValue({
        items: [
          {
            cardId: 'card-1',
            accountId: 'acc-1',
            accountNumber: '1234567890',
            cardholderName: 'Primary',
            panLast4: '4242',
            expiryMonth: 1,
            expiryYear: 2030,
            status: 'ACTIVE',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        hasMore: false,
      }),
    } as unknown as CardRepository;

    const cards = await listCards(
      { userId: 'user-1', accountId: 'acc-1' },
      { bankingRepository, cardRepository }
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].cardId).toBe('card-1');
  });

  it('throws when account does not exist', async () => {
    const bankingRepository = {
      getAccountById: vi.fn().mockResolvedValue(null),
    } as unknown as BankingRepository;
    const cardRepository = {
      listCardsByAccountId: vi.fn(),
    } as unknown as CardRepository;

    await expect(
      listCards(
        { userId: 'user-1', accountId: 'missing' },
        { bankingRepository, cardRepository }
      )
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('throws when account is not owned', async () => {
    const bankingRepository = {
      getAccountById: vi
        .fn()
        .mockResolvedValue(buildAccount({ ownerUserId: 'other' })),
    } as unknown as BankingRepository;
    const cardRepository = {
      listCardsByAccountId: vi.fn(),
    } as unknown as CardRepository;

    await expect(
      listCards(
        { userId: 'user-1', accountId: 'acc-1' },
        { bankingRepository, cardRepository }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lists cards across user accounts when accountId is omitted', async () => {
    const bankingRepository = {
      getAccountsByUserId: vi
        .fn()
        .mockResolvedValue([
          buildAccount({ id: 'acc-1' }),
          buildAccount({ id: 'acc-2', accountNumber: '1111111111' }),
        ]),
    } as unknown as BankingRepository;
    const cardRepository = {
      listCardsByAccountId: vi
        .fn()
        .mockImplementation(async (accountId: string) => ({
          items: [
            {
              cardId: `card-${accountId}`,
              accountId,
              accountNumber: '1234567890',
              cardholderName: 'Primary',
              panLast4: '4242',
              expiryMonth: 1,
              expiryYear: 2030,
              status: 'ACTIVE',
              createdAt:
                accountId === 'acc-1'
                  ? '2025-02-01T00:00:00.000Z'
                  : '2025-03-01T00:00:00.000Z',
              updatedAt: '2025-03-01T00:00:00.000Z',
            },
          ],
          hasMore: false,
        })),
    } as unknown as CardRepository;

    const cards = await listCards(
      { userId: 'user-1' },
      { bankingRepository, cardRepository }
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].createdAt).toBe('2025-03-01T00:00:00.000Z');
  });
});
