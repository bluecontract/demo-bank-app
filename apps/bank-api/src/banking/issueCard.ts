import {
  AccountNotFoundError,
  CardIssuanceError,
  ForbiddenError,
  issueCard,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const issueCardHandler = async (
  request: ServerInferRequest<(typeof bankApiContract)['banking']['issueCard']>,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, cardRepository, cardHasher, logger, config } =
    await getDependencies();
  const { userId, isTest } = await extractAuthInfo(context.request);
  const { accountId, cardholderName } = request.body;

  try {
    logger.info('Issuing card', { userId, accountId });

    const result = await issueCard(
      {
        userId,
        accountId,
        cardholderName,
        isTest,
      },
      {
        bankingRepository: repository,
        cardRepository,
        cardHasher,
        binPrefix: config.cardConfig.cardBinPrefix,
      }
    );

    logger.info('Card issued', {
      userId,
      accountId,
      cardId: result.card.cardId,
      cardLast4: result.card.panLast4,
    });

    return {
      status: 201 as const,
      body: {
        cardId: result.card.cardId,
        accountId: result.card.accountId,
        accountNumber: result.card.accountNumber,
        cardholderName: result.card.cardholderName,
        panLast4: result.card.panLast4,
        expiryMonth: result.card.expiryMonth,
        expiryYear: result.card.expiryYear,
        status: result.card.status,
        createdAt: result.card.createdAt,
        updatedAt: result.card.updatedAt,
        pan: result.pan,
        cvc: result.cvc,
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

    if (error instanceof CardIssuanceError) {
      return problemResponse({
        status: 500,
        code: ERROR_CODES.CARD_ISSUANCE_FAILED,
        message: error.message,
      });
    }

    throw error;
  }
};
