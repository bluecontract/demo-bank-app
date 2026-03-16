import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  getSupportedContractForDocument,
} from '@demo-bank-app/shared-bank-api-contract';
import { bootstrapPayNote as bootstrapPayNoteUseCase } from '@demo-bank-app/paynotes';
import { problemResponse, ERROR_CODES } from '../shared/errors';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { MIN_PAYNOTE_VERIFICATION_SCORE } from './constants';

const getPayloadSummary = (payload: unknown) => {
  if (payload && typeof payload === 'object') {
    return {
      payloadType: Array.isArray(payload) ? 'array' : 'object',
      payloadKeyCount: Object.keys(payload as Record<string, unknown>).length,
    };
  }
  return { payloadType: typeof payload };
};

export const bootstrapPayNoteHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['bootstrapPayNote']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const dependencies = await getDependencies();
  const {
    logger,
    payNoteVerificationRepository,
    myOsClient,
    blueIdCalculator,
    payNoteBootstrapRepository,
    contractRepository,
    clock,
  } = dependencies;

  try {
    const { userId, userEmail } = await extractAuthInfo(context.request);
    const { payNote, formData } = request.body;
    const supportedContract = getSupportedContractForDocument(payNote);

    if (
      !supportedContract ||
      supportedContract.typeName !== 'PayNote/PayNote'
    ) {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.UNSUPPORTED_CONTRACT_TYPE,
        message: 'Unsupported contract type.',
      });
    }

    logger.debug('Received PayNote bootstrap request', {
      userId,
      contractType: supportedContract.typeName,
      payNoteSummary: getPayloadSummary(payNote),
    });

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
        blueIdCalculator,
        payNoteBootstrapRepository,
        clock,
        minimumSuccessfulScore: MIN_PAYNOTE_VERIFICATION_SCORE,
      }
    );

    if (result.type === 'verification-failed') {
      logger.error('PayNote bootstrap rejected due to missing verification', {
        userId,
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

    logger.debug('MyOS bootstrap response received', {
      userId,
      status: result.response.status,
      ok: result.response.ok,
      responseBodySummary: getPayloadSummary(responseBody),
    });

    if (result.type === 'external-error') {
      logger.error('MyOS bootstrap request failed', {
        userId,
        status: result.response.status,
        responseBodySummary: getPayloadSummary(responseBody),
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

    if (result.type === 'success' && result.bootstrapSessionId) {
      const now = clock.now().toISOString();
      await contractRepository.saveContract({
        contractId: result.bootstrapSessionId,
        typeBlueId: supportedContract.typeBlueId,
        displayName: supportedContract.displayName,
        customerChannelKey: 'payerChannel',
        sessionId: result.bootstrapSessionId,
        document: result.preparedPayNote,
        status: 'bootstrapped',
        statusUpdatedAt: now,
        accountNumber: formData?.fromAccount,
        userId,
        createdAt: now,
        updatedAt: now,
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
