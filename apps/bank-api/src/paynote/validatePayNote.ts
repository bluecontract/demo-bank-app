import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { validatePayNote as validatePayNoteUseCase } from '@demo-bank-app/paynotes';
import { problemResponse, ERROR_CODES } from '../shared/errors';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import {
  MIN_PAYNOTE_VERIFICATION_SCORE,
  TEST_VERIFICATION_TTL_SECONDS,
} from './constants';
import { getDependencies } from './dependencies';

export const validatePayNoteHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['validatePayNote']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const {
    logger,
    getOpenAiValidationProvider,
    payNoteVerificationRepository,
    blueIdCalculator,
    clock,
  } = await getDependencies();
  const { userId, isTest } = await extractAuthInfo(context.request);

  try {
    const { yamlContent, formData } = request.body;

    logger.debug('Validating PayNote', {
      userId,
      hasYamlContent: Boolean(yamlContent),
      fromAccount: formData.fromAccount,
      toAccount: formData.toAccount,
    });

    if (!yamlContent || typeof yamlContent !== 'string') {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Missing PayNote YAML content.',
      });
    }

    const validationProvider = await getOpenAiValidationProvider();

    const result = await validatePayNoteUseCase(
      {
        userId,
        yamlContent,
        formData,
        isTestRun: isTest,
      },
      {
        verificationRepository: payNoteVerificationRepository,
        validationProvider,
        blueIdCalculator,
        clock,
        config: {
          minimumSuccessfulScore: MIN_PAYNOTE_VERIFICATION_SCORE,
          testVerificationTtlSeconds: TEST_VERIFICATION_TTL_SECONDS,
        },
      }
    );

    logger.info('PayNote validated', {
      userId,
      validationScore: result.validationScore,
      blueId: result.blueId,
      isSuccessful: result.isSuccessful,
    });

    return {
      status: 200 as const,
      body: {
        validationScore: result.validationScore,
        explanation: result.explanation,
      },
    };
  } catch (err) {
    logger.error('PayNote validation failed', {
      userId,
      error: String(err),
    });

    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Failed to validate PayNote',
    });
  }
};
