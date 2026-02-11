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
import { blue } from '../../../blue';

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

const resolveRequestId = (event: WebhookEmittedEvent): string | undefined =>
  resolveTransferRequestId(event);

const resolveTransferEventBlueId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    return blue.calculateBlueIdSync(blue.jsonValueToNode(event));
  } catch {
    return undefined;
  }
};

const isTransferEventType = (
  eventType: string | undefined
): eventType is
  | typeof RESERVE_FUNDS_EVENT_NAME
  | typeof CAPTURE_FUNDS_EVENT_NAME
  | typeof CAPTURE_IMMEDIATELY_EVENT_NAME =>
  eventType === RESERVE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_IMMEDIATELY_EVENT_NAME;

const reserveTransferRequestProcessing = async (input: {
  payNoteDocumentId: string;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  event: WebhookEmittedEvent;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  context: {
    eventId: string;
    requestId?: string;
  };
}): Promise<boolean> => {
  const { payNoteDocumentId, eventType, event, deps, logs, context } = input;
  const requestId = resolveRequestId(event);
  const eventBlueId = resolveTransferEventBlueId(event);
  const requestKey =
    requestId && requestId.trim().length > 0
      ? `request:${requestId}`
      : eventBlueId
      ? `event:${eventBlueId}`
      : undefined;

  if (!requestKey) {
    return true;
  }

  const dedupeEventId = [
    'paynote-transfer-request',
    payNoteDocumentId,
    eventType,
    requestKey,
  ].join(':');
  const firstProcessing = await deps.payNoteRepository.markEventProcessed(
    dedupeEventId
  );

  if (!firstProcessing) {
    logs.push({
      level: 'info',
      message: 'Skipped duplicate PayNote transfer request',
      context: {
        eventId: context.eventId,
        payNoteDocumentId,
        eventType,
        requestId: context.requestId ?? requestId,
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

const handleCaptureImmediately = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  transferAmountMinor: number;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      sessionId,
      payerAccountNumber,
      payeeAccountNumber,
      transferDescription,
      deps,
      logs,
    },
    account,
    event,
    transferAmountMinor,
  } = input;
  const requestId = resolveRequestId(event);

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
    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_DECLINED_EVENT_NAME,
        requestId,
        reason: 'Missing counterparty account number',
      }),
      successMessage: 'Reported PayNote capture declined via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote capture declined via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote capture declined update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: CAPTURE_IMMEDIATELY_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
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
    },
  });

  try {
    await deps.bankingFacade.transferFunds({
      sourceAccountId: account.id,
      destinationAccountNumber: payeeAccountNumber,
      amountMinor: transferAmountMinor,
      description: transferDescription,
      userId: account.ownerUserId,
      idempotencyKey: payNoteDocumentId,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to capture funds immediately';

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

    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      successMessage: 'Reported PayNote capture failed via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote capture failed via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote capture failed update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: CAPTURE_IMMEDIATELY_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
    return;
  }

  try {
    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: FUNDS_CAPTURED_EVENT_NAME,
        requestId,
        amountField: 'amountCaptured',
        amount: transferAmountMinor,
      }),
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: CAPTURE_IMMEDIATELY_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'PayNote immediate capture succeeded but guarantorUpdate reporting failed unexpectedly',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

const handleReserveFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  transferAmountMinor: number;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      sessionId,
      payerAccountNumber,
      payeeAccountNumber,
      deps,
      logs,
    },
    account,
    event,
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);

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
      idempotencyKey: payNoteDocumentId,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to reserve funds';

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

    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: RESERVATION_DECLINED_EVENT_NAME,
        requestId,
        reason,
      }),
      successMessage:
        'Reported PayNote reservation declined via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote reservation declined via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote reservation declined update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: RESERVE_FUNDS_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
    return;
  }

  try {
    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: FUNDS_RESERVED_EVENT_NAME,
        requestId,
        amountField: 'amountReserved',
        amount: transferAmountMinor,
      }),
      successMessage: 'Reported PayNote funds reserved via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds reserved via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds reserved update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: RESERVE_FUNDS_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'PayNote funds reserved but guarantorUpdate reporting failed unexpectedly',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

const handleCaptureFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
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
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);

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
    },
  });

  try {
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
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to capture funds';

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

    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      successMessage: 'Reported PayNote capture failed via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote capture failed via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote capture failed update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: CAPTURE_FUNDS_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
    return;
  }

  try {
    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: FUNDS_CAPTURED_EVENT_NAME,
        requestId,
        amountField: 'amountCaptured',
        amount: transferAmountMinor,
      }),
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType: CAPTURE_FUNDS_EVENT_NAME,
        requestId,
      },
      deps,
      logs,
    });
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'PayNote funds captured but guarantorUpdate reporting failed unexpectedly',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
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
    context: { eventId, payNoteDocumentId, sessionId, deps, logs },
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

  try {
    await emitGuarantorResponseEvent({
      sessionId,
      responseEvent: buildResponseEvent({
        type: responseEventType,
        requestId,
        reason: 'Missing payer account mapping',
      }),
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
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        requestId,
      },
      deps,
      logs,
    });
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'Failed to report PayNote decline due to missing payer mapping unexpectedly',
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
    const needsPayerResolution = events.some(event => {
      const eventType = resolveEmittedEventType(event);
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
        for (const event of events) {
          const eventType = resolveEmittedEventType(event);
          if (!isTransferEventType(eventType)) {
            continue;
          }

          const shouldProcess = await reserveTransferRequestProcessing({
            payNoteDocumentId,
            eventType,
            event,
            deps,
            logs,
            context: {
              eventId,
              requestId: resolveRequestId(event),
            },
          });
          if (!shouldProcess) {
            continue;
          }

          await emitDeclinedDueToMissingPayer({
            context: transferContext,
            event,
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

    for (const event of events) {
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType = resolveEmittedEventType(event);

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
          event,
          deps,
          logs,
          context: {
            eventId,
            requestId: resolveRequestId(event),
          },
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
          transferAmountMinor,
        });
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
