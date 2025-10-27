import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { MIN_PAYNOTE_VERIFICATION_SCORE } from './constants';
import { bootstrapPayNote as bootstrapPayNoteUseCase } from '@demo-bank-app/paynotes';
import {
  createBlueIdCalculator,
  createIdGenerator,
  createMyOsClient,
} from './useCaseAdapters';

export const bootstrapPayNoteHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['bootstrapPayNote']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { logger, getMyOsCredentials, payNoteVerificationRepository } =
    await getDependencies();

  try {
    const { userId, userEmail } = await extractAuthInfo(context.request);
    const { payNote, formData } = request.body;

    logger.info('Received PayNote bootstrap request', {
      userId,
      userEmail,
      payNote,
    });
    const myOsClient = createMyOsClient(getMyOsCredentials);

    const result = await bootstrapPayNoteUseCase(
      {
        userId,
        userEmail: userEmail ?? '',
        payNote,
        formData,
      },
      {
        verificationRepository: payNoteVerificationRepository,
        myOsClient,
        idGenerator: createIdGenerator(),
        blueIdCalculator: createBlueIdCalculator(),
        minimumSuccessfulScore: MIN_PAYNOTE_VERIFICATION_SCORE,
      }
    );

    if (result.type === 'verification-failed') {
      logger.error('PayNote bootstrap rejected due to missing verification', {
        userId,
        userEmail,
        blueId: result.blueId,
        hasVerification: Boolean(result.verification),
        verificationScore: result.verification?.validationScore,
      });

      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.PAYNOTE_NOT_VERIFIED,
        message: 'PayNote must be successfully validated before authorization.',
      });
    }

    if (result.type === 'missing-from-account') {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'From account is empty',
      });
    }

    const responseBody = result.response.body;

    logger.info('MyOS bootstrap response received', {
      userId,
      userEmail,
      status: result.response.status,
      ok: result.response.ok,
      responseBody,
    });

    if (result.type === 'external-error') {
      logger.error('MyOS bootstrap request failed', {
        userId,
        userEmail,
        status: result.response.status,
        responseBody,
      });

      const detail =
        typeof responseBody === 'string'
          ? responseBody
          : responseBody && typeof responseBody === 'object'
          ? JSON.stringify(responseBody)
          : undefined;

      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        message: 'MyOS bootstrap request failed.',
        detail,
      });
    }

    return {
      status: 200 as const,
      body: {
        message: 'Bootstrap accepted' as const,
      },
    };
  } catch (error) {
    logger.error('Failed to bootstrap PayNote', {
      error: error instanceof Error ? error.message : String(error),
    });

    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Unable to bootstrap PayNote.',
      detail: error instanceof Error ? error.message : undefined,
    });
  }
};
