import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  ActivityDetailDto,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import {
  AccountNotFoundError,
  TransactionNotFoundError,
  HoldNotFoundError,
  type Transaction,
  type Posting,
  type Hold,
  type HoldEvent,
} from '@demo-bank-app/banking';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const TXN_PREFIX = 'TXN#';
const HOLD_PREFIX = 'HOLD#';

const toIsoString = (date: Date) => date.toISOString();

const mapTransactionDetail = (
  transaction: Transaction,
  posting: Posting,
  activityId: string
): ActivityDetailDto => ({
  kind: 'POSTED_TRANSACTION',
  activityId,
  transactionId: transaction.id,
  amountMinor: posting.amountMinor,
  description: transaction.description,
  postedAt: toIsoString(transaction.createdAt),
  originHoldId: transaction.originHoldId,
  side: posting.side,
  type: transaction.type,
  status: transaction.status,
  counterpartyAccountNumber: posting.counterpartyAccountNumber,
  cardId: transaction.cardId,
  cardLast4: transaction.cardLast4,
  merchantName: transaction.merchantName,
  merchantStatementDescriptor: transaction.merchantStatementDescriptor,
  processorChargeId: transaction.processorChargeId,
  ...(transaction.payNoteDocumentId
    ? { payNote: { payNoteDocumentId: transaction.payNoteDocumentId } }
    : {}),
});

const mapHoldTimeline = (events: HoldEvent[]) =>
  events.map(event => {
    switch (event.type) {
      case 'CREATED':
        return {
          type: 'CREATED' as const,
          at: event.at,
          createdByUserId: event.createdByUserId,
          idempotencyKeyHash: event.idempotencyKeyHash,
          payNoteDocumentId: event.payNoteDocumentId,
        };
      case 'CAPTURED':
        return {
          type: 'CAPTURED' as const,
          at: event.at,
          transactionId: event.transactionId,
          counterpartyAccountNumber: event.counterpartyAccountNumber,
          payNoteDocumentId: event.payNoteDocumentId,
        };
      case 'RELEASED':
        return {
          type: 'RELEASED' as const,
          at: event.at,
          reason: event.reason,
          payNoteDocumentId: event.payNoteDocumentId,
        };
      case 'FAILED':
        return {
          type: 'FAILED' as const,
          at: event.at,
          code: event.code,
          message: event.message,
          payNoteDocumentId: event.payNoteDocumentId,
        };
    }
  });

const mapHoldDetail = (
  hold: Hold,
  events: HoldEvent[],
  activityId: string
): ActivityDetailDto => {
  const capturedEvent = events.find(event => event.type === 'CAPTURED');
  const failedEvent = events.find(event => event.type === 'FAILED');
  const payNoteDocumentId =
    hold.payNoteDocumentId ??
    events.find(event => event.payNoteDocumentId)?.payNoteDocumentId;

  return {
    kind: 'HOLD',
    activityId,
    holdId: hold.holdId,
    amountMinor: hold.amountMinor,
    currency: hold.currency,
    status: hold.status,
    description: hold.description,
    createdAt: hold.createdAt,
    expiresAt: hold.expiresAt,
    releasedAt: hold.releasedAt,
    releaseReason: hold.releaseReason,
    capturedAt: capturedEvent?.at,
    captureTransactionId: capturedEvent?.transactionId,
    failedAt: failedEvent?.at,
    failureCode: failedEvent?.code,
    failureMessage: failedEvent?.message,
    counterpartyAccountNumber:
      hold.counterpartyAccountNumber ??
      capturedEvent?.counterpartyAccountNumber,
    cardId: hold.cardId,
    cardLast4: hold.cardLast4,
    merchantName: hold.merchantName,
    merchantStatementDescriptor: hold.merchantStatementDescriptor,
    processorChargeId: hold.processorChargeId,
    timeline: mapHoldTimeline(events),
    ...(payNoteDocumentId ? { payNote: { payNoteDocumentId } } : {}),
  };
};

export const getActivityDetailHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getActivityDetail']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { repository, holdRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);

  const { accountNumber, activityId: rawActivityId } = request.params;
  const activityId = (() => {
    try {
      const decoded = decodeURIComponent(rawActivityId);
      if (decoded.startsWith('TXN--')) {
        return decoded.replace('--', '#');
      }
      if (decoded.startsWith('HOLD--')) {
        return decoded.replace('--', '#');
      }
      return decoded;
    } catch {
      if (rawActivityId.startsWith('TXN--')) {
        return rawActivityId.replace('--', '#');
      }
      if (rawActivityId.startsWith('HOLD--')) {
        return rawActivityId.replace('--', '#');
      }
      return rawActivityId;
    }
  })();

  logger.info('Fetching activity detail', {
    userId,
    accountNumber,
    activityId,
    rawActivityId,
  });

  try {
    const accountId = await repository.getAccountIdByNumber(accountNumber);
    if (!accountId) {
      throw new AccountNotFoundError(accountNumber);
    }

    const account = await repository.getAccountById(accountId);
    if (!account || !account.isOwnedBy(userId)) {
      throw new AccountNotFoundError(accountNumber);
    }

    if (activityId.startsWith(TXN_PREFIX)) {
      const transactionId = activityId.slice(TXN_PREFIX.length);
      if (!transactionId) {
        throw new TransactionNotFoundError(activityId);
      }

      const transaction = await repository.getTransactionById(transactionId);
      if (!transaction) {
        throw new TransactionNotFoundError(transactionId);
      }

      const posting = transaction.postings.find(
        item => item.accountId === account.id
      );

      if (!posting) {
        throw new TransactionNotFoundError(transactionId);
      }

      const detail = mapTransactionDetail(transaction, posting, activityId);

      return {
        status: 200 as const,
        body: detail,
      };
    }

    if (activityId.startsWith(HOLD_PREFIX)) {
      const holdId = activityId.slice(HOLD_PREFIX.length);
      if (!holdId) {
        throw new HoldNotFoundError(activityId);
      }

      const hold = await holdRepository.getHold(holdId);
      if (!hold || hold.payerAccountNumber !== account.accountNumber) {
        throw new HoldNotFoundError(holdId);
      }

      const events = await holdRepository.listHoldEvents(holdId);
      const detail = mapHoldDetail(hold, events, activityId);

      return {
        status: 200 as const,
        body: detail,
      };
    }

    return problemResponse({
      status: 404,
      code: ERROR_CODES.ACTIVITY_NOT_FOUND,
      message: 'Activity item not found for this account',
    });
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: error.message,
      });
    }

    if (
      error instanceof TransactionNotFoundError ||
      error instanceof HoldNotFoundError
    ) {
      return problemResponse({
        status: 404,
        code: ERROR_CODES.ACTIVITY_NOT_FOUND,
        message: error.message,
      });
    }

    logger.error('Failed to fetch activity detail', {
      userId,
      accountNumber,
      activityId,
      rawActivityId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
};
