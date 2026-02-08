import type {
  BankingAccount,
  PayNoteDeliveryRecord,
  PayNoteRecord,
} from '../../ports';
import type { LogEntry } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventResult,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import {
  CAPTURE_FUNDS_EVENT_NAME,
  CAPTURE_IMMEDIATELY_EVENT_NAME,
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
  RESERVE_FUNDS_EVENT_NAME,
  resolveEmittedEventType,
} from './events';
import { logAndReturn } from './logging';
import { upsertPayNoteContract } from './records';

const resolvePayerAccount = async (input: {
  payerAccountNumber: string;
  eventId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<
  | { account: BankingAccount & { ownerUserId: string } }
  | { result: HandleWebhookEventResult }
> => {
  const { payerAccountNumber, eventId, deps, logs } = input;

  const account = await deps.bankingFacade.getAccountByNumber(
    payerAccountNumber
  );

  if (!account) {
    const note = logAndReturn(
      logs,
      'error',
      'Unable to resolve payer account ID from number for PayNote transfer',
      {
        eventId,
        payerAccountNumber,
      }
    );
    return { result: { note, logs } };
  }

  if (!account.ownerUserId) {
    const note = logAndReturn(
      logs,
      'error',
      'Unable to resolve payer account owner for PayNote transfer',
      {
        eventId,
        payerAccountId: account.id,
      }
    );
    return { result: { note, logs } };
  }

  const accountWithOwner = account as BankingAccount & {
    ownerUserId: string;
  };

  return { account: accountWithOwner };
};

const syncPayNoteRecordAccount = async (input: {
  updatedRecord: PayNoteRecord;
  account: BankingAccount & { ownerUserId: string };
  deps: HandleWebhookEventDependencies;
}): Promise<void> => {
  const { updatedRecord, account, deps } = input;

  if (updatedRecord.userId && updatedRecord.accountNumber) {
    return;
  }

  updatedRecord.userId = account.ownerUserId;
  updatedRecord.accountNumber = account.accountNumber;
  const updatedAt = deps.clock.now().toISOString();
  updatedRecord.updatedAt = updatedAt;
  await deps.payNoteRepository.savePayNote({
    ...updatedRecord,
    updatedAt,
  });
};

type TransferContext = {
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  payerAccountNumber: string;
  payeeAccountNumber?: string;
  transferDescription: string;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  account: BankingAccount & { ownerUserId: string };
};

const handleCaptureImmediately = async (
  context: TransferContext,
  transferAmountMinor: number
): Promise<void> => {
  const {
    eventId,
    payNoteDocumentId,
    payerAccountNumber,
    payeeAccountNumber,
    transferDescription,
    account,
    deps,
    logs,
  } = context;

  if (!payeeAccountNumber) {
    logs.push({
      level: 'warn',
      message: 'PayNote transfer missing counterparty account number',
      context: {
        eventId,
        payNoteDocumentId,
      },
    });
    return;
  }

  logs.push({
    level: 'info',
    message: 'PayNote transfer triggered',
    context: {
      eventId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });

  await deps.bankingFacade.transferFunds({
    sourceAccountId: account.id,
    destinationAccountNumber: payeeAccountNumber,
    amountMinor: transferAmountMinor,
    description: transferDescription,
    userId: account.ownerUserId,
    idempotencyKey: payNoteDocumentId,
    payNoteDocumentId,
  });
};

const handleCaptureFunds = async (
  context: TransferContext,
  transferAmountMinor: number
): Promise<void> => {
  const {
    eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    emittedEvents,
    payerAccountNumber,
    payeeAccountNumber,
    updatedRecord,
    deliveryRecord,
    account,
    deps,
    logs,
  } = context;

  logs.push({
    level: 'info',
    message: 'PayNote capture hold triggered',
    context: {
      eventId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });

  const capturedHold = await deps.bankingFacade.captureHold({
    holdId: payNoteDocumentId,
    userId: account.ownerUserId,
    idempotencyKey: payNoteDocumentId,
    counterpartyAccountNumber: payeeAccountNumber,
    payNoteDocumentId,
  });

  const capturedTransactionId = capturedHold.relatedTransactionId;
  const capturedHoldId = capturedHold.holdId;
  const shouldUpdateHoldId = !updatedRecord.holdId && capturedHoldId;
  const shouldUpdateTransactionId =
    Boolean(capturedTransactionId) &&
    capturedTransactionId !== updatedRecord.transactionId;

  if (!shouldUpdateHoldId && !shouldUpdateTransactionId) {
    return;
  }

  if (shouldUpdateHoldId) {
    updatedRecord.holdId = capturedHoldId;
  }
  if (shouldUpdateTransactionId) {
    updatedRecord.transactionId = capturedTransactionId;
  }

  const updatedAt = deps.clock.now().toISOString();
  updatedRecord.updatedAt = updatedAt;
  await deps.payNoteRepository.savePayNote(updatedRecord);

  await upsertPayNoteContract({
    updatedRecord,
    deliveryRecord,
    sessionId,
    payNoteDocumentId,
    eventType: CAPTURE_FUNDS_EVENT_NAME,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents,
    now: updatedAt,
    deps,
  });

  if (deliveryRecord && shouldUpdateTransactionId) {
    await deps.payNoteDeliveryRepository.saveDelivery({
      ...deliveryRecord,
      transactionId: updatedRecord.transactionId,
      updatedAt,
    });
  }
};

const handleReserveFunds = async (
  context: TransferContext,
  transferAmountMinor: number
): Promise<void> => {
  const {
    eventId,
    payNoteDocumentId,
    payerAccountNumber,
    payeeAccountNumber,
    account,
    deps,
    logs,
  } = context;

  logs.push({
    level: 'info',
    message: 'PayNote reserve funds triggered',
    context: {
      eventId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });

  await deps.bankingFacade.reserveFunds({
    holdId: payNoteDocumentId,
    payerAccountNumber,
    amountMinor: transferAmountMinor,
    counterpartyAccountNumber: payeeAccountNumber,
    userId: account.ownerUserId,
    idempotencyKey: payNoteDocumentId,
    payNoteDocumentId,
  });
};

const logIgnoredTransferEvent = (
  context: TransferContext,
  eventType: string | undefined,
  transferAmountMinor: number
) => {
  const { eventId, payerAccountNumber, payeeAccountNumber, logs } = context;

  logs.push({
    level: 'info',
    message: 'PayNote webhook event ignored',
    context: {
      eventId,
      eventType,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });
};

export const handleTransferEvents = async (input: {
  events: WebhookEmittedEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  transferDescription: string;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<HandleWebhookEventResult | null> => {
  const {
    events,
    eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    emittedEvents,
    payerAccountNumber,
    payeeAccountNumber,
    transferDescription,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  } = input;

  const requiresPayerAccount = events.some(event => {
    const eventType = resolveEmittedEventType(event);
    return (
      eventType === CAPTURE_IMMEDIATELY_EVENT_NAME ||
      eventType === CAPTURE_FUNDS_EVENT_NAME ||
      eventType === RESERVE_FUNDS_EVENT_NAME
    );
  });

  if (!payerAccountNumber) {
    if (!requiresPayerAccount) {
      return { note: '', logs };
    }

    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing payer account mapping',
      {
        eventId,
        payNoteDocumentId,
      }
    );
    return { note, logs };
  }

  try {
    const accountResolution = await resolvePayerAccount({
      payerAccountNumber,
      eventId,
      deps,
      logs,
    });

    if ('result' in accountResolution) {
      return accountResolution.result;
    }

    const account = accountResolution.account;
    await syncPayNoteRecordAccount({ updatedRecord, account, deps });
    const transferContext: TransferContext = {
      eventId,
      payNoteDocumentId,
      sessionId,
      eventObject,
      emittedEvents,
      payerAccountNumber,
      payeeAccountNumber,
      transferDescription,
      updatedRecord,
      deliveryRecord,
      deps,
      logs,
      account,
    };

    for (const event of events) {
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType = resolveEmittedEventType(event);

      if (
        eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
        eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
      ) {
        continue;
      }

      if (eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
        await handleCaptureImmediately(transferContext, transferAmountMinor);
        continue;
      }

      if (eventType === CAPTURE_FUNDS_EVENT_NAME) {
        await handleCaptureFunds(transferContext, transferAmountMinor);
        continue;
      }

      if (eventType === RESERVE_FUNDS_EVENT_NAME) {
        await handleReserveFunds(transferContext, transferAmountMinor);
        continue;
      }

      logIgnoredTransferEvent(transferContext, eventType, transferAmountMinor);
    }
  } catch (error) {
    const note = logAndReturn(
      logs,
      'error',
      'Unexpected error preparing PayNote capture transfer',
      {
        eventId,
        payerAccountNumber,
        payeeAccountNumber,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { note, logs };
  }

  return null;
};
