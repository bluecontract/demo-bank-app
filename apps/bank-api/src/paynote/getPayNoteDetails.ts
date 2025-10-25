import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { AccountNotFoundError, type Account } from '@demo-bank-app/banking';

type FetchCredentialsFn = () => Promise<{
  apiKey: string;
  baseUrl: string;
}>;

class MyOsRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'MyOsRequestError';
  }
}

const buildMyOsEventUrl = (baseUrl: string, eventId: string) =>
  `${baseUrl}/myos-events/${encodeURIComponent(eventId)}`;

const fetchMyOsEvent = async (
  eventId: string,
  getCredentials: FetchCredentialsFn
): Promise<any> => {
  try {
    const credentials = await getCredentials();
    const response = await fetch(
      buildMyOsEventUrl(credentials.baseUrl, eventId),
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: credentials.apiKey,
        },
      }
    );

    if (response.status === 404) {
      throw new MyOsRequestError('MyOS event not found', response.status);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => undefined);
      throw new MyOsRequestError(
        `MyOS request failed with status ${response.status}`,
        response.status,
        detail
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new MyOsRequestError(
        'Failed to parse MyOS response body',
        response.status,
        error instanceof Error ? error.message : String(error)
      );
    }
  } catch (error) {
    if (error instanceof MyOsRequestError) {
      throw error;
    }

    throw new MyOsRequestError(
      'Unexpected error while contacting MyOS',
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }
};

const ensureAccountOwnership = async (
  accountNumber: string,
  userId: string,
  repository: {
    getAccountIdByNumber: (accountNumber: string) => Promise<string | null>;
    getAccountById: (accountId: string) => Promise<Account | null>;
  }
) => {
  const accountId = await repository.getAccountIdByNumber(accountNumber);
  if (!accountId) {
    throw new AccountNotFoundError(accountNumber);
  }

  const account = await repository.getAccountById(accountId);
  if (!account || !account.isOwnedBy(userId)) {
    throw new AccountNotFoundError(accountNumber);
  }

  return account;
};

export const getPayNoteDetailsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDetails']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { logger, getMyOsCredentials, bankingRepository } =
    await getDependencies();

  const { accountNumber, myosEventId } = request.params;

  logger.info('Fetching PayNote details', {
    accountNumber,
    myosEventId,
  });

  try {
    const { userId } = await extractAuthInfo(context.request);
    const account = await ensureAccountOwnership(
      accountNumber,
      userId,
      bankingRepository
    );

    let eventPayload: any;
    try {
      eventPayload = await fetchMyOsEvent(myosEventId, getMyOsCredentials);
    } catch (error) {
      if (error instanceof MyOsRequestError && error.status === 404) {
        logger.warn('PayNote event not found in MyOS', {
          accountNumber,
          myosEventId,
        });
        return problemResponse({
          status: 404,
          code: ERROR_CODES.PAYNOTE_NOT_FOUND,
          message: 'PayNote event not found for this account.',
        });
      }

      logger.error('Failed to retrieve PayNote event from MyOS', {
        accountNumber,
        myosEventId,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof MyOsRequestError && (error.status || error.detail)
          ? {
              myOsStatus: error.status,
              myOsDetail: error.detail,
            }
          : {}),
      });

      return problemResponse({
        status: 500,
        code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        message: 'Unable to fetch PayNote details from MyOS.',
        detail: error instanceof MyOsRequestError ? error.detail : undefined,
      });
    }

    const payNoteObject = eventPayload?.object ?? {};
    const document = payNoteObject?.document as Record<string, any> | undefined;
    const payerAccountFromDocument =
      typeof document?.payerAccountNumber?.value === 'string'
        ? document.payerAccountNumber.value
        : undefined;

    // TODO(iteration 4): Persist PayNote linkage (myosEventId -> hold/transaction)
    // to avoid relying on document payload for authorization.
    if (payerAccountFromDocument !== account.accountNumber) {
      logger.warn('PayNote event document does not match account owner', {
        accountNumber,
        myosEventId,
        payerAccountFromDocument,
      });
      return problemResponse({
        status: 404,
        code: ERROR_CODES.PAYNOTE_NOT_FOUND,
        message: 'PayNote event not found for this account.',
      });
    }

    const detail = {
      myosEventId,
      documentYaml:
        typeof payNoteObject.documentYaml === 'string'
          ? payNoteObject.documentYaml
          : undefined,
      transactionRequest: payNoteObject.emitted ?? null,
      triggerEvent: payNoteObject.triggeredBy ?? null,
      fetchedAt: new Date().toISOString(),
    };

    logger.info('PayNote details fetched successfully', {
      accountNumber,
      myosEventId,
    });

    return {
      status: 200 as const,
      body: detail,
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
