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
  const cardFields = {
    cardId: item.cardId,
    cardLast4: item.cardLast4,
    merchantName: item.merchantName,
    merchantId: item.merchantId,
    merchantStatementDescriptor: item.merchantStatementDescriptor,
    processorChargeId: item.processorChargeId,
  };
  const payNoteFields = item.payNoteDocumentId
    ? { payNote: { payNoteDocumentId: item.payNoteDocumentId } }
    : {};

  switch (item.kind) {
    case 'POSTED_TRANSACTION':
      return {
        kind: item.kind,
        activityId: item.activityId,
        transactionId: item.transactionId,
        amountMinor: item.amountMinor,
        description: item.description,
        postedAt: item.postedAt,
        originHoldId: item.originHoldId,
        side: item.side,
        type: item.type,
        status: item.status,
        counterpartyAccountNumber: item.counterpartyAccountNumber,
        ...payNoteFields,
        ...cardFields,
      } as const;
    case 'HOLD_CREATED':
      return {
        kind: item.kind,
        activityId: item.activityId,
        holdId: item.holdId,
        amountMinor: item.amountMinor,
        description: item.description,
        createdAt: item.createdAt,
        counterpartyAccountNumber: item.counterpartyAccountNumber,
        createdByUserId: item.createdByUserId,
        idempotencyKeyHash: item.idempotencyKeyHash,
        ...payNoteFields,
        ...cardFields,
      } as const;
    case 'HOLD_RELEASED':
      return {
        kind: item.kind,
        activityId: item.activityId,
        holdId: item.holdId,
        amountMinor: item.amountMinor,
        description: item.description,
        releasedAt: item.releasedAt,
        releaseReason: item.releaseReason,
        ...payNoteFields,
        ...cardFields,
      } as const;
    case 'HOLD_CAPTURED':
      return {
        kind: item.kind,
        activityId: item.activityId,
        holdId: item.holdId,
        amountMinor: item.amountMinor,
        description: item.description,
        capturedAt: item.capturedAt,
        transactionId: item.transactionId,
        counterpartyAccountNumber: item.counterpartyAccountNumber,
        ...payNoteFields,
        ...cardFields,
      } as const;
    case 'HOLD_FAILED':
      return {
        kind: item.kind,
        activityId: item.activityId,
        holdId: item.holdId,
        amountMinor: item.amountMinor,
        description: item.description,
        failedAt: item.failedAt,
        failureCode: item.failureCode,
        failureMessage: item.failureMessage,
        ...payNoteFields,
        ...cardFields,
      } as const;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
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
    logger.debug('Listing account activity', {
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
