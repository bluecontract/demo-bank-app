import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { AccountNotFoundError } from '@demo-bank-app/banking';
import {
  getPayNoteDetails as getPayNoteDetailsUseCase,
  createBlueIdCalculator,
  createSystemClock,
} from '@demo-bank-app/paynotes';
import { ERROR_CODES, problemResponse } from '../../shared/errors';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../../auth/middleware';
import type { PaynoteDependencies } from '../dependencies';

export interface GetPayNoteDetailsExecutionContext {
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDetails']
  >;
  context: { request: MaybeAuthenticatedTsRestRequestContext };
  dependencies: PaynoteDependencies;
}

export const executeGetPayNoteDetails = async ({
  request,
  context,
  dependencies,
}: GetPayNoteDetailsExecutionContext) => {
  const { logger, myOsClient, bankingFacade } = dependencies;

  const { accountNumber, myosEventId } = request.params;

  logger.info('Fetching PayNote details', {
    accountNumber,
    myosEventId,
  });

  try {
    const { userId } = await extractAuthInfo(context.request);

    const result = await getPayNoteDetailsUseCase(
      {
        accountNumber,
        myOsEventId: myosEventId,
        userId,
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator: createBlueIdCalculator(),
        clock: createSystemClock(),
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

    if (result.type === 'event-not-found') {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.PAYNOTE_NOT_FOUND,
        message: 'PayNote event not found for this account.',
      });
    }

    if (result.type === 'external-error') {
      return problemResponse({
        status: 500,
        code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        message: 'Unable to fetch PayNote details from MyOS.',
        detail: result.detail,
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
      myosEventId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
};
