import {
  AccountNotFoundError,
  ForbiddenError,
  listCards,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const listCardsHandler = async (
  request: ServerInferRequest<(typeof bankApiContract)['banking']['listCards']>,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, cardRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.query?.accountId;

  try {
    logger.debug('Listing cards', { userId, accountId });

    const cards = await listCards(
      {
        userId,
        accountId,
      },
      { bankingRepository: repository, cardRepository }
    );

    return {
      status: 200 as const,
      body: {
        cards: cards.map(card => ({
          cardId: card.cardId,
          accountId: card.accountId,
          accountNumber: card.accountNumber,
          cardholderName: card.cardholderName,
          panLast4: card.panLast4,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          status: card.status,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        })),
      },
    };
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: 'Account not found',
      });
    }

    if (error instanceof ForbiddenError) {
      return problemResponse({
        status: 403,
        code: ERROR_CODES.FORBIDDEN,
        message: 'Forbidden access',
      });
    }

    throw error;
  }
};
