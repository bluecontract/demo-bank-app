import {
  AccountNotFoundError,
  IdempotencyConflictError,
  InvalidAccountError,
  authorizeCard,
} from '@demo-bank-app/banking';
import { resolveMonitoringReportStatusFromHoldStatus } from '@demo-bank-app/contracts';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import { getDependencies as getPaynoteDependencies } from '../paynote/dependencies';
import { requireProcessorAuth } from '../auth/processorAuth';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { reportCardTransactionToMonitoringSubscribers } from '../contracts/reportMonitoringTransaction';

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
    contractRepository,
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
    logger.debug('Authorizing card charge', {
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
      logger.debug('Card authorization declined', {
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

    logger.debug('Card authorization approved', {
      processorChargeId: request.body.processorChargeId,
      authorizationId: result.hold.holdId,
      cardId: result.card.cardId,
      accountNumber: result.card.accountNumber,
    });

    try {
      const merchantId =
        result.hold.merchantId ?? request.body.merchant.merchantId;
      const reportStatus =
        resolveMonitoringReportStatusFromHoldStatus(result.hold.status) ??
        'authorized';

      let ownerUserId: string | undefined = result.card.ownerUserId;
      if (!ownerUserId) {
        const accountId = await repository.getAccountIdByNumber(
          result.card.accountNumber
        );
        if (accountId) {
          const account = await repository.getAccountById(accountId);
          ownerUserId = account?.ownerUserId;
        }
      }

      if (merchantId && ownerUserId) {
        const { myOsClient } = await getPaynoteDependencies();
        await reportCardTransactionToMonitoringSubscribers({
          contractRepository,
          myOsClient,
          logger,
          userId: ownerUserId,
          merchantId,
          reportEvent: {
            type: 'PayNote/Card Transaction Report',
            status: reportStatus,
            amountMinor: result.hold.amountMinor,
            currency: result.hold.currency,
            occurredAt: result.hold.createdAt ?? new Date().toISOString(),
            merchantId,
            transactionId: result.hold.holdId,
            cardTransactionDetails: result.hold.cardTransactionDetails,
          },
          reportTransactionId: result.hold.holdId,
          relatedHoldId: result.hold.holdId,
        });
      }
    } catch (error) {
      logger.warn(
        'Failed to report card authorization to monitoring subscribers',
        {
          authorizationId: result.hold.holdId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

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
