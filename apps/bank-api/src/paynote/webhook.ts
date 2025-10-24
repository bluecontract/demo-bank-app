import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { Money, transferMoney } from '@demo-bank-app/banking';
import type { MyOsCredentials } from '../shared/myOsSecrets';
import { getDependencies } from './dependencies';

// There are several other events you can react to: https://github.com/bluecontract/blue-repository/tree/main/PayNote
const CAPTURE_EVENT_NAME = 'Capture Funds Requested';
const CAPTURE_IMMIDIETLY_EVENT_NAME =
  'Reserve Funds and Capture Immediately Requested';

const returnResponse = (note?: string) => ({
  status: 200 as const,
  body: note
    ? ({ status: 'ok' as const, note } as const)
    : ({ status: 'ok' as const } as const),
});

const downloadPayNoteEvent = async (
  eventId: string,
  getMyOsCredentials: () => Promise<
    Pick<MyOsCredentials, 'apiKey' | 'baseUrl'>
  >,
  logError: (message: string, context?: Record<string, unknown>) => string
): Promise<{ payload: any | null; note?: string }> => {
  try {
    const credentials = await getMyOsCredentials();
    const response = await fetch(
      `${credentials.baseUrl}/myos-events/${eventId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: credentials.apiKey,
        },
      }
    );

    if (!response.ok) {
      const note = logError('Failed to download PayNote event from MyOS', {
        eventId,
        status: response.status,
        statusText: response.statusText,
      });
      return { payload: null, note };
    }

    try {
      const payload = await response.json();
      return { payload };
    } catch (error) {
      const note = logError('Failed to parse PayNote event payload', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { payload: null, note };
    }
  } catch (error) {
    const note = logError('Unexpected error while downloading PayNote event', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { payload: null, note };
  }
};

export const payNoteWebhookHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['payNoteWebhook']
  >
) => {
  const { logger, getMyOsCredentials, bankingRepository } =
    await getDependencies();

  const logError = (
    message: string,
    context?: Record<string, unknown>
  ): string => {
    logger.error(message, context);
    return message;
  };

  const { id: eventId } = request.body ?? {};

  if (!eventId || typeof eventId !== 'string') {
    return returnResponse(
      logError('PayNote webhook received payload without valid id', {
        payload: request.body,
      })
    );
  }

  const { payload: eventPayload, note: downloadNote } =
    await downloadPayNoteEvent(eventId, getMyOsCredentials, logError);

  if (!eventPayload) {
    return returnResponse(downloadNote);
  }

  const sessionId = eventPayload?.object?.sessionId as string | undefined;
  const document = eventPayload?.object?.document as
    | {
        payerAccountNumber: { value: string };
        payeeAccountNumber: { value: string };
        amount: { total: number };
        name?: string;
      }
    | undefined;

  if (!document) {
    return returnResponse(
      logError('PayNote event missing document payload', { eventId })
    );
  }

  const payerAccountNumber = document.payerAccountNumber?.value;
  const payeeAccountNumber = document.payeeAccountNumber?.value;
  const transferAmountMinor = document.amount?.total;
  const transferDescription = document.name || 'PayNote transfer';

  const events =
    (eventPayload?.object?.emitted as Array<
      { type?: { name?: string } } | undefined
    >) ?? [];
  const emittedEventNames = events
    .map(item => item?.type?.name)
    .filter(Boolean) as string[];

  const emittedContainsCapture =
    emittedEventNames.includes(CAPTURE_EVENT_NAME) ||
    emittedEventNames.includes(CAPTURE_IMMIDIETLY_EVENT_NAME);

  logger.info('Received PayNote webhook', {
    eventId,
    emittedContainsCapture,
    emittedEventNames,
    sessionId,
    payerAccountNumber,
    payeeAccountNumber,
  });

  if (!emittedContainsCapture) {
    return returnResponse();
  }

  if (!sessionId) {
    return returnResponse(
      logError('PayNote capture event missing sessionId, transfer skipped', {
        eventId,
      })
    );
  }

  if (!payerAccountNumber || !payeeAccountNumber) {
    return returnResponse(
      logError(
        'PayNote capture event missing account numbers, transfer skipped',
        {
          eventId,
          payerAccountNumber,
          payeeAccountNumber,
        }
      )
    );
  }

  if (!transferAmountMinor || transferAmountMinor <= 0) {
    return returnResponse(
      logError('PayNote capture event missing amount, transfer skipped', {
        eventId,
        payerAccountNumber,
        payeeAccountNumber,
        transferAmountMinor,
      })
    );
  }

  try {
    const payerAccountId = await bankingRepository.getAccountIdByNumber(
      payerAccountNumber
    );

    if (!payerAccountId) {
      return returnResponse(
        logError(
          'Unable to resolve payer account ID from number for PayNote transfer',
          {
            eventId,
            payerAccountNumber,
          }
        )
      );
    }

    const payerAccount = await bankingRepository.getAccountById(payerAccountId);

    if (!payerAccount) {
      return returnResponse(
        logError('Unable to load payer account for PayNote transfer', {
          eventId,
          payerAccountId,
        })
      );
    }

    const ownerUserId = (payerAccount as { ownerUserId?: string }).ownerUserId;
    if (!ownerUserId) {
      return returnResponse(
        logError('Unable to resolve payer account owner for PayNote transfer', {
          eventId,
          payerAccountId,
        })
      );
    }

    try {
      const txnId = await transferMoney(
        {
          srcAccountId: payerAccountId,
          dstAccountNumber: String(payeeAccountNumber),
          amountMinor: new Money(transferAmountMinor),
          description: transferDescription,
          ctx: {
            userId: ownerUserId,
            idempotencyKey: String(sessionId),
          },
        },
        {
          repository: bankingRepository,
        }
      );

      logger.info('PayNote capture transfer executed', {
        eventId,
        txnId,
        payerAccountId,
        payerAccountNumber,
        payeeAccountNumber,
        transferAmountMinor,
      });
    } catch (error) {
      return returnResponse(
        logError('PayNote capture transfer failed', {
          eventId,
          payerAccountId,
          payerAccountNumber,
          payeeAccountNumber,
          transferAmountMinor,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  } catch (error) {
    return returnResponse(
      logError('Unexpected error preparing PayNote capture transfer', {
        eventId,
        payerAccountNumber,
        payeeAccountNumber,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  return returnResponse('');
};
