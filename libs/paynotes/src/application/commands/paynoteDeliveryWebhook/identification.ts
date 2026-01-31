import type { CardTransactionDetails, Hold } from '@demo-bank-app/banking';
import type { LogEntry, PayNoteDeliveryRecord } from '../../ports';
import { log, trace } from '../paynoteWebhook/logging';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';
import { buildOperationSessionIds } from './records';

export const identifyDeliveryTransaction = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  cardDetails: CardTransactionDetails;
  eventId: string;
  deliveryId: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<Hold | null> => {
  const { deliveryRecord, cardDetails, eventId, deliveryId, deps, logs } =
    input;

  if (deliveryRecord.userId) {
    return null;
  }

  const hold = await deps.holdRepository.getHoldByCardTransactionDetails(
    cardDetails
  );

  if (!hold) {
    deliveryRecord.transactionIdentificationStatus = 'failed';
    trace(logs, 'Delivery transaction identification lookup', {
      eventId,
      deliveryId,
      holdId: null,
      status: deliveryRecord.transactionIdentificationStatus,
    });
    return null;
  }

  const accountId = await deps.bankingRepository.getAccountIdByNumber(
    hold.payerAccountNumber
  );
  const account = accountId
    ? await deps.bankingRepository.getAccountById(accountId)
    : null;

  if (account && account.ownerUserId) {
    deliveryRecord.userId = account.ownerUserId;
    deliveryRecord.accountNumber = account.accountNumber;
    deliveryRecord.holdId = hold.holdId;
    deliveryRecord.transactionId = hold.relatedTransactionId;
    deliveryRecord.transactionIdentificationStatus = 'identified';
  } else {
    deliveryRecord.transactionIdentificationStatus = 'failed';
  }

  trace(logs, 'Delivery transaction identification lookup', {
    eventId,
    deliveryId,
    holdId: hold.holdId,
    payerAccountNumber: hold.payerAccountNumber,
    accountId,
    userId: account?.ownerUserId ?? null,
    status: deliveryRecord.transactionIdentificationStatus,
  });

  return hold;
};

export const reportIdentificationStatusIfNeeded = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  sessionId?: string;
  eventId: string;
  deliveryId: string;
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { deliveryRecord, sessionId, eventId, deliveryId, now, deps, logs } =
    input;

  if (
    deliveryRecord.identificationReportedAt ||
    !deliveryRecord.transactionIdentificationStatus ||
    !['identified', 'failed'].includes(
      deliveryRecord.transactionIdentificationStatus
    )
  ) {
    return;
  }

  const operationSessionIds = buildOperationSessionIds(
    sessionId,
    deliveryRecord.deliverySessionIds,
    deliveryRecord.deliverySessionId
  );

  if (!operationSessionIds.length) {
    log(
      logs,
      'warn',
      'Delivery identification status not reported (no session id)',
      {
        eventId,
        deliveryId,
      }
    );
    return;
  }

  const credentials = await deps.myOsClient.getCredentials();
  let reported = false;
  let lastResponse: { status: number; body?: unknown } | null = null;

  for (const operationSessionId of operationSessionIds) {
    const response = await deps.myOsClient.runDocumentOperation({
      credentials,
      sessionId: operationSessionId,
      operation: 'updateTransactionIdentificationStatus',
      payload: deliveryRecord.transactionIdentificationStatus === 'identified',
    });

    if (response.ok) {
      deliveryRecord.identificationReportedAt = now;
      trace(logs, 'Reported delivery identification status to MyOS', {
        eventId,
        deliveryId,
        deliverySessionId: operationSessionId,
        status: deliveryRecord.transactionIdentificationStatus,
      });
      reported = true;
      break;
    }

    lastResponse = { status: response.status, body: response.body };
  }

  if (!reported) {
    log(logs, 'error', 'Failed to report identification status', {
      eventId,
      deliveryId,
      deliverySessionIds: operationSessionIds,
      status: lastResponse?.status,
      body: lastResponse?.body,
    });
  }
};
