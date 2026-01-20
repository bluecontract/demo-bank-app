import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { AccountNotFoundError } from '@demo-bank-app/banking';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getPayNoteDetails as getPayNoteDetailsUseCase } from '@demo-bank-app/paynotes';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';

export const getPayNoteDetailsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDetails']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    logger,
    bankingFacade,
    payNoteRepository,
    payNoteDeliveryRepository,
    blueIdCalculator,
    clock,
  } = await getDependencies();

  const { accountNumber, payNoteDocumentId } = request.params;

  logger.info('Fetching PayNote details', {
    accountNumber,
    payNoteDocumentId,
  });

  try {
    const { userId } = await extractAuthInfo(context.request);

    const result = await getPayNoteDetailsUseCase(
      {
        accountNumber,
        payNoteDocumentId,
        userId,
      },
      {
        bankingFacade,
        payNoteRepository,
        payNoteDeliveryRepository,
        blueIdCalculator,
        clock,
      }
    );

    result.logs.forEach(entry => {
      if (entry.level === 'error') {
        logger.error(entry.message, entry.context);
      } else if (entry.level === 'warn') {
        logger.warn(entry.message, entry.context);
      } else {
        logger.info(entry.message, entry.context);
      }
    });

    if (result.type === 'account-not-found') {
      const error = new AccountNotFoundError(accountNumber);
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: error.message,
      });
    }

    if (result.type === 'paynote-not-found') {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.PAYNOTE_NOT_FOUND,
        message: 'PayNote not found for this account.',
      });
    }

    return {
      status: 200 as const,
      body: result.detail,
    };
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: error.message,
      });
    }

    logger.error('Unexpected error fetching PayNote details', {
      accountNumber,
      payNoteDocumentId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
};
