import { describe, it, expect, vi } from 'vitest';
import { getCard } from './getCard';
import type { CardRepository } from '../CardRepository';
import { CardNotFoundError, ForbiddenError } from '../errors';

describe('getCard', () => {
  it('returns card when owned by user', async () => {
    const cardRepository = {
      getCardById: vi.fn().mockResolvedValue({
        cardId: 'card-1',
        accountId: 'acc-1',
        accountNumber: '1234567890',
        ownerUserId: 'user-1',
        cardholderName: 'Primary',
        panLast4: '4242',
        panHash: 'hash',
        cvcHash: 'cvc',
        expiryMonth: 1,
        expiryYear: 2030,
        status: 'ACTIVE',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      }),
    } as unknown as CardRepository;

    const card = await getCard(
      { userId: 'user-1', cardId: 'card-1' },
      { cardRepository }
    );

    expect(card.cardId).toBe('card-1');
  });

  it('throws when card is missing', async () => {
    const cardRepository = {
      getCardById: vi.fn().mockResolvedValue(null),
    } as unknown as CardRepository;

    await expect(
      getCard({ userId: 'user-1', cardId: 'missing' }, { cardRepository })
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('throws when card is not owned by user', async () => {
    const cardRepository = {
      getCardById: vi.fn().mockResolvedValue({
        cardId: 'card-1',
        accountId: 'acc-1',
        accountNumber: '1234567890',
        ownerUserId: 'user-2',
        cardholderName: 'Primary',
        panLast4: '4242',
        panHash: 'hash',
        cvcHash: 'cvc',
        expiryMonth: 1,
        expiryYear: 2030,
        status: 'ACTIVE',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      }),
    } as unknown as CardRepository;

    await expect(
      getCard({ userId: 'user-1', cardId: 'card-1' }, { cardRepository })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
