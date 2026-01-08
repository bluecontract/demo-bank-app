import { Blue } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import {
  CaptureFundsRequestedSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type {
  BankingFacade,
  LogEntry,
  MyOsClient,
  MyOsFetchEventResult,
} from '../ports';

const RESERVE_FUNDS_EVENT_NAME = 'PayNote/Reserve Funds Requested';
const CAPTURE_FUNDS_EVENT_NAME = 'PayNote/Capture Funds Requested';
const CAPTURE_IMMEDIATELY_EVENT_NAME =
  'PayNote/Reserve Funds and Capture Immediately Requested';

const blue = new Blue({
  repositories: [repository],
});

const resolveEventTypeLabel = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const fallbackType = (event as { type?: { name?: unknown } }).type?.name;
  return typeof fallbackType === 'string' ? fallbackType : undefined;
};

const resolveEventType = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  try {
    const node = blue.jsonValueToNode(event);
    if (blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema)) {
      return CAPTURE_IMMEDIATELY_EVENT_NAME;
    }
    if (blue.isTypeOf(node, CaptureFundsRequestedSchema)) {
      return CAPTURE_FUNDS_EVENT_NAME;
    }
    if (blue.isTypeOf(node, ReserveFundsRequestedSchema)) {
      return RESERVE_FUNDS_EVENT_NAME;
    }
  } catch {
    // ignore parse failures; the label fallback is handled separately
  }

  return undefined;
};

export interface HandleWebhookEventInput {
  eventId: string;
}

export interface HandleWebhookEventDependencies {
  myOsClient: MyOsClient;
  bankingFacade: BankingFacade;
}

export interface HandleWebhookEventResult {
  note?: string;
  logs: LogEntry[];
}

const logAndReturn = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  logs.push({ level, message, context });
  return message;
};

const mapFetchEventError = (
  result: MyOsFetchEventResult,
  eventId: string,
  logs: LogEntry[]
): HandleWebhookEventResult => {
  switch (result.kind) {
    case 'not-found': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to download PayNote event from MyOS',
        {
          eventId,
          status: result.status,
        }
      );
      return { note, logs };
    }
    case 'http-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to download PayNote event from MyOS',
        {
          eventId,
          status: result.status,
          statusText: result.statusText,
        }
      );
      return { note, logs };
    }
    case 'parse-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to parse PayNote event payload',
        {
          eventId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        }
      );
      return { note, logs };
    }
    case 'network-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Unexpected error while downloading PayNote event',
        {
          eventId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        }
      );
      return { note, logs };
    }
    default:
      return { note: undefined, logs };
  }
};

export const handleWebhookEvent = async (
  input: HandleWebhookEventInput,
  deps: HandleWebhookEventDependencies
): Promise<HandleWebhookEventResult> => {
  const logs: LogEntry[] = [];

  const eventResult = await deps.myOsClient.fetchEvent(input.eventId);
  if (eventResult.kind !== 'success') {
    return mapFetchEventError(eventResult, input.eventId, logs);
  }

  const eventPayload = eventResult.payload as {
    object?: {
      document?: {
        payNoteBankId?: { value?: string };
        payerAccountNumber?: { value?: string };
        payeeAccountNumber?: { value?: string };
        amount?: { total?: { value?: number } };
        name?: string;
      };
      emitted?: Array<{
        type?: { name?: string };
        amount?: { value?: number };
      }>;
    };
  };

  const document = eventPayload?.object?.document;

  if (!document) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing document payload',
      { eventId: input.eventId }
    );
    return { note, logs };
  }

  const payNoteBankId = document.payNoteBankId?.value;
  const payerAccountNumber = document.payerAccountNumber?.value;
  const payeeAccountNumber = document.payeeAccountNumber?.value;
  const transferDescription = document.name || 'PayNote transfer';

  if (!payNoteBankId) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing payNoteBankId',
      {
        eventId: input.eventId,
        payNoteBankId,
      }
    );
    return { note, logs };
  }

  if (!payerAccountNumber || !payeeAccountNumber) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing account numbers',
      {
        eventId: input.eventId,
        payerAccountNumber,
        payeeAccountNumber,
      }
    );
    return { note, logs };
  }

  try {
    const account = await deps.bankingFacade.getAccountByNumber(
      payerAccountNumber
    );

    if (!account) {
      const note = logAndReturn(
        logs,
        'error',
        'Unable to resolve payer account ID from number for PayNote transfer',
        {
          eventId: input.eventId,
          payerAccountNumber,
        }
      );
      return { note, logs };
    }

    if (!account.ownerUserId) {
      const note = logAndReturn(
        logs,
        'error',
        'Unable to resolve payer account owner for PayNote transfer',
        {
          eventId: input.eventId,
          payerAccountId: account.id,
        }
      );
      return { note, logs };
    }

    const events =
      eventPayload?.object?.emitted ??
      ([] as Array<{ type?: { name?: string }; amount?: { value?: number } }>);

    logs.push({
      level: 'info',
      message: 'Received PayNote webhook',
      context: {
        eventId: input.eventId,
        events,
        payNoteBankId,
        payerAccountNumber,
        payeeAccountNumber,
      },
    });

    for (const event of events) {
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType = resolveEventType(event);
      const eventTypeLabel = eventType ?? resolveEventTypeLabel(event);

      if (eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
        logs.push({
          level: 'info',
          message: 'PayNote transfer triggered',
          context: {
            eventId: input.eventId,
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
          idempotencyKey: payNoteBankId,
          payNoteEventId: input.eventId,
        });
      } else if (eventType === CAPTURE_FUNDS_EVENT_NAME) {
        logs.push({
          level: 'info',
          message: 'PayNote capture hold triggered',
          context: {
            eventId: input.eventId,
            payerAccountId: account.id,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });

        await deps.bankingFacade.captureHold({
          holdId: payNoteBankId,
          userId: account.ownerUserId,
          idempotencyKey: payNoteBankId,
          counterpartyAccountNumber: payeeAccountNumber,
          payNoteEventId: input.eventId,
        });
      } else if (eventType === RESERVE_FUNDS_EVENT_NAME) {
        logs.push({
          level: 'info',
          message: 'PayNote reserve funds triggered',
          context: {
            eventId: input.eventId,
            payerAccountId: account.id,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });

        await deps.bankingFacade.reserveFunds({
          holdId: payNoteBankId,
          payerAccountNumber,
          amountMinor: transferAmountMinor,
          counterpartyAccountNumber: payeeAccountNumber,
          userId: account.ownerUserId,
          idempotencyKey: payNoteBankId,
          payNoteEventId: input.eventId,
        });
      } else {
        logs.push({
          level: 'info',
          message: 'PayNote webhook event ignored',
          context: {
            eventId: input.eventId,
            eventType: eventTypeLabel,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });
      }
    }
  } catch (error) {
    const note = logAndReturn(
      logs,
      'error',
      'Unexpected error preparing PayNote capture transfer',
      {
        eventId: input.eventId,
        payerAccountNumber,
        payeeAccountNumber,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { note, logs };
  }

  return { note: '', logs };
};
