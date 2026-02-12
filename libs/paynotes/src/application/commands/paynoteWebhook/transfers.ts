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
  resolveTransferRequestId,
} from './events';
import { logAndReturn } from './logging';
import { upsertPayNoteContract } from './records';
import { runGuarantorUpdate } from '../documentOperations';
import type { DispatchedTransferEvent } from './eventDispatcher';

const FUNDS_RESERVED_EVENT_NAME = 'PayNote/Funds Reserved';
const RESERVATION_DECLINED_EVENT_NAME = 'PayNote/Reservation Declined';
const FUNDS_CAPTURED_EVENT_NAME = 'PayNote/Funds Captured';
const CAPTURE_DECLINED_EVENT_NAME = 'PayNote/Capture Declined';
const CAPTURE_FAILED_EVENT_NAME = 'PayNote/Capture Failed';

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
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  transferDescription: string;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
};

type TransferEventWithMetadata = DispatchedTransferEvent;

const resolveRequestId = (event: WebhookEmittedEvent): string | undefined =>
  resolveTransferRequestId(event);

const isTransferEventType = (
  eventType: string | undefined
): eventType is
  | typeof RESERVE_FUNDS_EVENT_NAME
  | typeof CAPTURE_FUNDS_EVENT_NAME
  | typeof CAPTURE_IMMEDIATELY_EVENT_NAME =>
  eventType === RESERVE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_IMMEDIATELY_EVENT_NAME;

const buildTransferOperationIdempotencyKey = (input: {
  eventId: string;
  eventIndex: number;
  operation: 'capture-immediately' | 'reserve-funds' | 'capture-funds';
}): string =>
  [
    'paynote-transfer',
    input.operation,
    input.eventId,
    String(input.eventIndex),
  ].join(':');

const reserveTransferRequestProcessing = async (input: {
  payNoteDocumentId: string;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventId: string;
  eventIndex: number;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const { payNoteDocumentId, eventType, eventId, eventIndex, deps, logs } =
    input;

  const dedupeEventId = [
    'paynote-transfer-request',
    payNoteDocumentId,
    eventId,
    String(eventIndex),
  ].join(':');
  const firstProcessing = await deps.payNoteRepository.markEventProcessed(
    dedupeEventId
  );

  if (!firstProcessing) {
    logs.push({
      level: 'info',
      message: 'Skipped duplicate PayNote transfer request',
      context: {
        eventId,
        payNoteDocumentId,
        eventIndex,
        eventType,
        dedupeEventId,
      },
    });
    return false;
  }

  return true;
};

const buildResponseEvent = (input: {
  type: string;
  requestId?: string;
  amountField?: 'amountReserved' | 'amountCaptured';
  amount?: number;
  reason?: string;
}): Record<string, unknown> => {
  const event: Record<string, unknown> = {
    type: input.type,
  };

  if (input.requestId) {
    event.inResponseTo = {
      requestId: input.requestId,
    };
  }

  if (input.amountField && typeof input.amount === 'number') {
    event[input.amountField] = input.amount;
  }

  if (typeof input.reason === 'string' && input.reason.trim().length > 0) {
    event.reason = input.reason;
  }

  return event;
};

const resolveCredentials = async (
  deps: HandleWebhookEventDependencies,
  logs: LogEntry[],
  context: {
    eventId: string;
    payNoteDocumentId: string;
    sessionId: string;
  }
): Promise<Awaited<
  ReturnType<HandleWebhookEventDependencies['myOsClient']['getCredentials']>
> | null> => {
  try {
    return await deps.myOsClient.getCredentials();
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'Failed to resolve MyOS credentials for PayNote guarantor update',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};

const emitGuarantorResponseEvent = async (input: {
  sessionId: string;
  responseEvent: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
  context: {
    eventId: string;
    payNoteDocumentId: string;
    eventType?: string;
    requestId?: string;
  };
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const credentials = await resolveCredentials(input.deps, input.logs, {
    eventId: input.context.eventId,
    payNoteDocumentId: input.context.payNoteDocumentId,
    sessionId: input.sessionId,
  });

  return runGuarantorUpdate({
    myOsClient: input.deps.myOsClient,
    sessionId: input.sessionId,
    credentials,
    logs: input.logs,
    logContext: {
      ...input.context,
      responseEventType:
        resolveEmittedEventType(input.responseEvent as WebhookEmittedEvent) ??
        input.responseEvent.type,
    },
    request: [input.responseEvent],
    successMessage: input.successMessage,
    failureMessage: input.failureMessage,
    missingCredentialsMessage: input.missingCredentialsMessage,
  });
};

type TransferResponseMessages = {
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
};

const emitTransferGuarantorResponse = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  requestId?: string;
  responseEvent: Record<string, unknown>;
  messages: TransferResponseMessages;
}): Promise<boolean> => {
  const {
    context: { sessionId, eventId, payNoteDocumentId, deps, logs },
    eventType,
    requestId,
    responseEvent,
    messages,
  } = input;

  return emitGuarantorResponseEvent({
    sessionId,
    responseEvent,
    successMessage: messages.successMessage,
    failureMessage: messages.failureMessage,
    missingCredentialsMessage: messages.missingCredentialsMessage,
    context: {
      eventId,
      payNoteDocumentId,
      eventType,
      requestId,
    },
    deps,
    logs,
  });
};

const emitTransferGuarantorResponseSafely = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  requestId?: string;
  responseEvent: Record<string, unknown>;
  messages: TransferResponseMessages;
  unexpectedFailureMessage: string;
}): Promise<void> => {
  const {
    context: { eventId, payNoteDocumentId, logs },
    eventType,
    requestId,
    unexpectedFailureMessage,
  } = input;

  try {
    await emitTransferGuarantorResponse(input);
  } catch (error) {
    logs.push({
      level: 'error',
      message: unexpectedFailureMessage,
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

const resolveFailureReason = (
  error: unknown,
  fallbackReason: string
): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallbackReason;
};

const handleCaptureImmediately = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      payerAccountNumber,
      payeeAccountNumber,
      transferDescription,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;
  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    eventId,
    eventIndex,
    operation: 'capture-immediately',
  });
  const eventType = CAPTURE_IMMEDIATELY_EVENT_NAME;

  if (!payeeAccountNumber) {
    logs.push({
      level: 'warn',
      message: 'PayNote capture immediately request declined',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason: 'Missing counterparty account number',
      },
    });
    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_DECLINED_EVENT_NAME,
        requestId,
        reason: 'Missing counterparty account number',
      }),
      messages: {
        successMessage: 'Reported PayNote capture declined via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture declined via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture declined update (missing MyOS credentials)',
      },
    });
    return;
  }

  logs.push({
    level: 'info',
    message: 'PayNote capture immediately request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  try {
    await deps.bankingFacade.transferFunds({
      sourceAccountId: account.id,
      destinationAccountNumber: payeeAccountNumber,
      amountMinor: transferAmountMinor,
      description: transferDescription,
      userId: account.ownerUserId,
      idempotencyKey,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason = resolveFailureReason(
      error,
      'Unable to capture funds immediately'
    );

    logs.push({
      level: 'warn',
      message: 'PayNote capture immediately request failed',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage: 'Reported PayNote capture failed via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture failed via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture failed update (missing MyOS credentials)',
      },
    });
    return;
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_CAPTURED_EVENT_NAME,
      requestId,
      amountField: 'amountCaptured',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote immediate capture succeeded but guarantorUpdate reporting failed unexpectedly',
  });
};

const handleReserveFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      payerAccountNumber,
      payeeAccountNumber,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    eventId,
    eventIndex,
    operation: 'reserve-funds',
  });
  const eventType = RESERVE_FUNDS_EVENT_NAME;

  logs.push({
    level: 'info',
    message: 'PayNote reserve funds request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  if (!payerAccountNumber) {
    throw new Error('Missing payer account number');
  }

  try {
    await deps.bankingFacade.reserveFunds({
      holdId: payNoteDocumentId,
      payerAccountNumber,
      amountMinor: transferAmountMinor,
      counterpartyAccountNumber: payeeAccountNumber,
      userId: account.ownerUserId,
      idempotencyKey,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason = resolveFailureReason(error, 'Unable to reserve funds');

    logs.push({
      level: 'warn',
      message: 'PayNote reserve funds request declined',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: RESERVATION_DECLINED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage:
          'Reported PayNote reservation declined via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote reservation declined via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote reservation declined update (missing MyOS credentials)',
      },
    });
    return;
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_RESERVED_EVENT_NAME,
      requestId,
      amountField: 'amountReserved',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds reserved via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds reserved via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds reserved update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote funds reserved but guarantorUpdate reporting failed unexpectedly',
  });
};

const handleCaptureFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      sessionId,
      eventObject,
      emittedEvents,
      payeeAccountNumber,
      updatedRecord,
      deliveryRecord,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    eventId,
    eventIndex,
    operation: 'capture-funds',
  });
  const eventType = CAPTURE_FUNDS_EVENT_NAME;

  logs.push({
    level: 'info',
    message: 'PayNote capture funds request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payeeAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  try {
    const capturedHold = await deps.bankingFacade.captureHold({
      holdId: payNoteDocumentId,
      userId: account.ownerUserId,
      idempotencyKey,
      amountMinor: transferAmountMinor > 0 ? transferAmountMinor : undefined,
      counterpartyAccountNumber: payeeAccountNumber,
      payNoteDocumentId,
    });

    const capturedTransactionId = capturedHold.relatedTransactionId;
    const capturedHoldId = capturedHold.holdId;
    const shouldUpdateHoldId = !updatedRecord.holdId && capturedHoldId;
    const shouldUpdateTransactionId =
      Boolean(capturedTransactionId) &&
      capturedTransactionId !== updatedRecord.transactionId;

    if (shouldUpdateHoldId) {
      updatedRecord.holdId = capturedHoldId;
    }
    if (shouldUpdateTransactionId) {
      updatedRecord.transactionId = capturedTransactionId;
    }

    if (shouldUpdateHoldId || shouldUpdateTransactionId) {
      const updatedAt = deps.clock.now().toISOString();
      updatedRecord.updatedAt = updatedAt;
      await deps.payNoteRepository.savePayNote(updatedRecord);

      await upsertPayNoteContract({
        updatedRecord,
        deliveryRecord,
        sessionId,
        payNoteDocumentId,
        eventType,
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
    }
  } catch (error) {
    const reason = resolveFailureReason(error, 'Unable to capture funds');

    logs.push({
      level: 'warn',
      message: 'PayNote capture funds request failed',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage: 'Reported PayNote capture failed via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture failed via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture failed update (missing MyOS credentials)',
      },
    });
    return;
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_CAPTURED_EVENT_NAME,
      requestId,
      amountField: 'amountCaptured',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote funds captured but guarantorUpdate reporting failed unexpectedly',
  });
};

const emitDeclinedDueToMissingPayer = async (input: {
  context: TransferContext;
  event: WebhookEmittedEvent;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
}): Promise<void> => {
  const {
    context: { eventId, payNoteDocumentId, logs },
    event,
    eventType,
  } = input;
  const requestId = resolveRequestId(event);
  const responseEventType =
    eventType === RESERVE_FUNDS_EVENT_NAME
      ? RESERVATION_DECLINED_EVENT_NAME
      : CAPTURE_DECLINED_EVENT_NAME;

  logs.push({
    level: 'warn',
    message: 'PayNote request declined (missing payer account mapping)',
    context: {
      eventId,
      payNoteDocumentId,
      eventType,
      requestId,
    },
  });

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: responseEventType,
      requestId,
      reason: 'Missing payer account mapping',
    }),
    messages: {
      successMessage: `Reported PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      failureMessage: `Failed to report PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      missingCredentialsMessage: `Skipped PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } update (missing MyOS credentials)`,
    },
    unexpectedFailureMessage:
      'Failed to report PayNote decline due to missing payer mapping unexpectedly',
  });
};

const logIgnoredTransferEvent = (
  context: TransferContext,
  eventIndex: number,
  eventType: string | undefined,
  transferAmountMinor: number
) => {
  const { eventId, payerAccountNumber, payeeAccountNumber, logs } = context;

  logs.push({
    level: 'info',
    message: 'PayNote webhook event ignored',
    context: {
      eventId,
      eventIndex,
      eventType,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });
};

export const handleTransferEvents = async (input: {
  events: TransferEventWithMetadata[];
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
  };

  try {
    const needsPayerResolution = events.some(transferEvent => {
      const eventType =
        transferEvent.eventType ?? resolveEmittedEventType(transferEvent.event);
      return isTransferEventType(eventType);
    });

    let resolvedAccount: (BankingAccount & { ownerUserId: string }) | null =
      null;
    if (needsPayerResolution && payerAccountNumber) {
      const accountResolution = await resolvePayerAccount({
        payerAccountNumber,
        eventId,
        deps,
        logs,
      });

      if ('result' in accountResolution) {
        for (const transferEvent of events) {
          const eventType =
            transferEvent.eventType ??
            resolveEmittedEventType(transferEvent.event);
          if (!isTransferEventType(eventType)) {
            continue;
          }

          const shouldProcess = await reserveTransferRequestProcessing({
            payNoteDocumentId,
            eventType,
            eventId,
            eventIndex: transferEvent.eventIndex,
            deps,
            logs,
          });
          if (!shouldProcess) {
            continue;
          }

          await emitDeclinedDueToMissingPayer({
            context: transferContext,
            event: transferEvent.event,
            eventType,
          });
        }
        return accountResolution.result;
      }

      resolvedAccount = accountResolution.account;
      await syncPayNoteRecordAccount({
        updatedRecord,
        account: resolvedAccount,
        deps,
      });
    }

    for (const transferEvent of events) {
      const event = transferEvent.event;
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType =
        transferEvent.eventType ?? resolveEmittedEventType(event);
      const { eventIndex } = transferEvent;

      if (
        eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
        eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
      ) {
        continue;
      }

      if (isTransferEventType(eventType)) {
        const shouldProcess = await reserveTransferRequestProcessing({
          payNoteDocumentId,
          eventType,
          eventId,
          eventIndex,
          deps,
          logs,
        });
        if (!shouldProcess) {
          continue;
        }

        if (!payerAccountNumber || !resolvedAccount) {
          await emitDeclinedDueToMissingPayer({
            context: transferContext,
            event,
            eventType,
          });
          continue;
        }
      }

      if (eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleCaptureImmediately({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      if (eventType === RESERVE_FUNDS_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleReserveFundsRequest({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      if (eventType === CAPTURE_FUNDS_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleCaptureFundsRequest({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      logIgnoredTransferEvent(
        transferContext,
        eventIndex,
        eventType,
        transferAmountMinor
      );
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
