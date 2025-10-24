import {
  listAccountActivity,
  AccountNotFoundError,
  InvalidActivityCursorError,
  type ActivityItem,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const toResponseItem = (item: ActivityItem) => {
  if (item.kind === 'PENDING_HOLD') {
    return {
      kind: item.kind,
      holdId: item.holdId,
      amountMinor: item.amountMinor,
      description: item.description,
      createdAt: item.createdAt,
    } as const;
  }

  return {
    kind: item.kind,
    transactionId: item.transactionId,
    amountMinor: item.amountMinor,
    description: item.description,
    postedAt: item.postedAt,
    originHoldId: item.originHoldId,
  } as const;
};

export const listAccountActivityHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listActivity']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { repository, holdRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountNumber = request.params.accountNumber;

  try {
    logger.info('Listing account activity', {
      userId,
      accountNumber,
    });

    const result = await listAccountActivity(
      {
        userId,
        accountNumber,
        limit: request.query?.limit,
        cursor: request.query?.cursor,
      },
      {
        bankingRepository: repository,
        holdRepository,
        logger,
      }
    );

    return {
      status: 200 as const,
      body: {
        items: result.items.map(toResponseItem),
        nextCursor: result.nextToken,
      },
    };
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: error.message,
      });
    }

    if (error instanceof InvalidActivityCursorError) {
      return problemResponse({
        status: 400,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: error.message,
      });
    }

    throw error;
  }
};
