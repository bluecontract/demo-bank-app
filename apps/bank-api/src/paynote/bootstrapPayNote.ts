import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { calculateBlueIdFromObject } from './blueId';
import { MIN_PAYNOTE_VERIFICATION_SCORE } from './constants';
import { randomUUID } from 'crypto';

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
        userEmail,
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

    payNote.payNoteBankId = {
      type: 'Text',
      value: randomUUID(),
    };

    if (formData.fromAccount) {
      if (!payNote.payerAccountNumber) {
        payNote.payerAccountNumber = {};
      }
      payNote.payerAccountNumber.type = 'Text';
      payNote.payerAccountNumber.value = formData.fromAccount;
    } else {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'From account is empty',
      });
    }

    if (formData.toAccount) {
      if (!payNote.payeeAccountNumber) {
        payNote.payeeAccountNumber = {};
      }
      payNote.payeeAccountNumber.type = 'Text';
      payNote.payeeAccountNumber.value = formData.toAccount;
    }

    const credentials = await getMyOsCredentials();

    const contracts = (payNote.contracts ?? {}) as Record<
      string,
      { type?: string; email?: string; accountId?: string }
    >;

    const channelBindings: Record<
      string,
      { email?: string; accountId?: string }
    > = {};

    if (contracts.payerChannel) {
      // set payer to current user by default if payerChannel exists in paynote
      channelBindings.payerChannel = { email: userEmail };
    }

    Object.entries(contracts).forEach(([k, v]) => {
      if (v?.type === 'MyOS Timeline Channel') {
        if (v?.email) {
          channelBindings[k] = {
            email: v.email,
          };
        } else if (v?.accountId) {
          channelBindings[k] = {
            accountId: v.accountId,
          };
        } else if (!channelBindings[k]) {
          // default all not specified to bank account
          channelBindings[k] = {
            accountId: credentials.accountId,
          };
        }
      }
    });

    const payload = {
      channelBindings,
      document: payNote,
    };

    const bootstrapUrl = `${credentials.baseUrl}/documents/bootstrap`;

    const response = await fetch(bootstrapUrl, {
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
      userEmail,
      status: response.status,
      ok: response.ok,
      responseBody,
    });

    if (!response.ok) {
      logger.error('MyOS bootstrap request failed', {
        userId,
        userEmail,
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
