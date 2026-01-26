import {
  CardNotFoundError,
  ForbiddenError,
  getCard,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const getCardHandler = async (
  request: ServerInferRequest<(typeof bankApiContract)['banking']['getCard']>,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { cardRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const cardId = request.params.cardId;

  try {
    logger.info('Getting card', { userId, cardId });

    const card = await getCard(
      {
        userId,
        cardId,
      },
      { cardRepository }
    );

    return {
      status: 200 as const,
      body: {
        cardId: card.cardId,
        accountId: card.accountId,
        accountNumber: card.accountNumber,
        cardholderName: card.cardholderName,
        pan: card.pan,
        cvc: card.cvc,
        panLast4: card.panLast4,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        status: card.status,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
    };
  } catch (error) {
    if (error instanceof CardNotFoundError) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.CARD_NOT_FOUND,
        message: 'Card not found',
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
