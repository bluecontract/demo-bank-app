import {
  AccountNotFoundError,
  HoldCaptureDisabledError,
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyConflictError,
  captureCardAuthorization,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import { requireProcessorAuth } from '../auth/processorAuth';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const mergeUnique = (existing?: string[], incoming?: string[]) => {
  const set = new Set<string>(existing ?? []);
  (incoming ?? []).forEach(value => {
    if (value) {
      set.add(value);
    }
  });
  return set.size ? Array.from(set) : undefined;
};

export const captureCardAuthorizationHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['captureCardAuthorization']
  >,
  context: {
    request: { headers: Headers };
  }
) => {
  const { repository, holdRepository, contractRepository, logger, config } =
    await getDependencies();

  requireProcessorAuth(context.request, config.cardConfig.cardProcessorToken);

  const idempotencyKey = request.headers?.['idempotency-key'];
  if (!idempotencyKey) {
    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  }

  const authorizationId = request.params.authorizationId;

  try {
    logger.info('Capturing card authorization', {
      authorizationId,
      amountMinor: request.body.amountMinor,
    });

    const result = await captureCardAuthorization(
      {
        authorizationId,
        amountMinor: request.body.amountMinor,
        idempotencyKey,
      },
      {
        bankingRepository: repository,
        holdRepository,
      }
    );

    logger.info('Card authorization captured', {
      authorizationId: result.holdId,
      transactionId: result.transactionId,
    });

    try {
      const relatedContracts = await contractRepository.listContractsByHoldId(
        result.holdId
      );
      if (relatedContracts.length) {
        const now = new Date().toISOString();
        await Promise.all(
          relatedContracts.map(async contractSummary => {
            const contract = await contractRepository.getContract(
              contractSummary.contractId
            );
            if (!contract) {
              return;
            }
            if (
              contract.relatedTransactionIds?.includes(result.transactionId)
            ) {
              return;
            }
            await contractRepository.saveContract({
              ...contract,
              relatedTransactionIds: mergeUnique(
                contract.relatedTransactionIds,
                [result.transactionId]
              ),
              updatedAt: now,
            });
          })
        );
      }
    } catch (error) {
      logger.warn('Failed to link captured transaction to contracts', {
        holdId: result.holdId,
        transactionId: result.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      status: 200 as const,
      body: {
        status: 'CAPTURED' as const,
        authorizationId: result.holdId,
        transactionId: result.transactionId,
      },
    };
  } catch (error) {
    if (error instanceof HoldNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.AUTHORIZATION_NOT_FOUND,
        message: 'Authorization not found',
      });
    }

    if (error instanceof HoldNotPendingError) {
      return problemResponse({
        status: 409 as const,
        code: ERROR_CODES.AUTHORIZATION_NOT_PENDING,
        message: error.message,
      });
    }

    if (error instanceof HoldCaptureDisabledError) {
      return problemResponse({
        status: 409 as const,
        code: ERROR_CODES.AUTHORIZATION_CAPTURE_DISABLED,
        message: error.message,
      });
    }

    if (error instanceof IdempotencyConflictError) {
      return problemResponse({
        status: 409 as const,
        code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
        message: error.message,
      });
    }

    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: error.message,
      });
    }

    throw error;
  }
};
