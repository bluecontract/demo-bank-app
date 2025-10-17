import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { calculateBlueIdFromObject } from './blueId';
import {
  MIN_PAYNOTE_VERIFICATION_SCORE,
  MYOS_BOOTSTRAP_URL,
} from './constants';

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
    const { userId } = await extractAuthInfo(context.request);
    const { payNote } = request.body;

    logger.info('Received PayNote bootstrap request', {
      userId,
      payNote,
    });

    const blueId = calculateBlueIdFromObject(
      payNote as Record<string, unknown>
    );

    const verification = await payNoteVerificationRepository.getVerification({
      userId,
      blueId,
    });

    if (
      !verification ||
      !verification.isSuccessful ||
      verification.validationScore < MIN_PAYNOTE_VERIFICATION_SCORE
    ) {
      logger.error('PayNote bootstrap rejected due to missing verification', {
        userId,
        blueId,
        hasVerification: Boolean(verification),
        verificationScore: verification?.validationScore,
      });

      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.PAYNOTE_NOT_VERIFIED,
        message: 'PayNote must be successfully validated before authorization.',
      });
    }

    const credentials = await getMyOsCredentials();

    const payload = {
      channelBindings: {
        payerChannel: {
          email: 'payer@example.com',
        },
        payeeChannel: {
          email: 'payee@example.com',
        },
        guarantorChannel: {
          accountId: credentials.accountId,
        },
      },
      document: payNote,
    };

    const response = await fetch(MYOS_BOOTSTRAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: credentials.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response
      .clone()
      .json()
      .catch(() => undefined);

    logger.info('MyOS bootstrap response received', {
      userId,
      status: response.status,
      ok: response.ok,
      responseBody,
    });

    if (!response.ok) {
      logger.error('MyOS bootstrap request failed', {
        userId,
        status: response.status,
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
        message: 'Bootstrap accepted',
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
