import {
  AccountNotFoundError,
  IdempotencyConflictError,
  InvalidAccountError,
  authorizeCard,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import { requireProcessorAuth } from '../auth/processorAuth';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const authorizeCardHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['authorizeCard']
  >,
  context: {
    request: { headers: Headers };
  }
) => {
  const {
    repository,
    cardRepository,
    holdRepository,
    cardHasher,
    logger,
    config,
  } = await getDependencies();

  requireProcessorAuth(context.request, config.cardConfig.cardProcessorToken);

  const idempotencyKey = request.headers?.['idempotency-key'];
  if (!idempotencyKey) {
    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  }

  const panLast4 = request.body.pan.slice(-4);

  try {
    logger.info('Authorizing card charge', {
      processorChargeId: request.body.processorChargeId,
      amountMinor: request.body.amountMinor,
      cardLast4: panLast4,
    });

    const result = await authorizeCard(
      {
        pan: request.body.pan,
        expiryMonth: request.body.expiryMonth,
        expiryYear: request.body.expiryYear,
        cvc: request.body.cvc,
        amountMinor: request.body.amountMinor,
        currency: request.body.currency,
        merchant: request.body.merchant,
        processorChargeId: request.body.processorChargeId,
        description: request.body.description,
        idempotencyKey,
      },
      {
        bankingRepository: repository,
        cardRepository,
        holdRepository,
        cardHasher,
      }
    );

    if (result.status === 'DECLINED') {
      logger.info('Card authorization declined', {
        processorChargeId: request.body.processorChargeId,
        declineCode: result.declineCode,
        cardLast4: panLast4,
      });

      return {
        status: 200 as const,
        body: {
          status: 'DECLINED' as const,
          declineCode: result.declineCode,
          message: result.message,
        },
      };
    }

    logger.info('Card authorization approved', {
      processorChargeId: request.body.processorChargeId,
      authorizationId: result.hold.holdId,
      cardId: result.card.cardId,
      accountNumber: result.card.accountNumber,
    });

    return {
      status: 200 as const,
      body: {
        status: 'APPROVED' as const,
        authorizationId: result.hold.holdId,
        cardId: result.card.cardId,
        accountNumber: result.card.accountNumber,
        cardTransactionDetails: result.hold.cardTransactionDetails,
      },
    };
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return problemResponse({
        status: 409 as const,
        code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
        message: error.message,
      });
    }

    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: 'Account not found',
      });
    }

    if (error instanceof InvalidAccountError) {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: error.message,
      });
    }

    throw error;
  }
};
