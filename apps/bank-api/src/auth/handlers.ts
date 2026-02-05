import {
  signUp,
  signIn,
  type AuthResult,
  UserNotFoundError,
  UserAlreadyExistsError,
} from '@demo-bank-app/auth';
import { createAccount } from '@demo-bank-app/banking';

import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';

import { getDependencies } from './dependencies';
import { getDependencies as getBankingDependencies } from '../banking/dependencies';
import { ServerInferRequest } from '@ts-rest/core';
import { toUnauthorizedResponse } from '../shared/errors';
import { toUserAlreadyExistsError } from './errors';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from './middleware';

const COOKIE_CONFIG = {
  NAME: 'demoAuth',
  ATTRIBUTES: 'HttpOnly; Secure; SameSite=Strict; Path=/',
} as const;

const createAuthCookie = (token: string, ttlSeconds: number): string => {
  return `${COOKIE_CONFIG.NAME}=${token}; Max-Age=${ttlSeconds}; ${COOKIE_CONFIG.ATTRIBUTES}`;
};

const getTtlSeconds = (
  user: AuthResult['user'],
  config: { jwtTtlSeconds: number; testUserTtlSeconds: number }
): number => {
  return user?.isTest ? config.testUserTtlSeconds : config.jwtTtlSeconds;
};

const toUserProfileBody = (user: AuthResult['user']) => ({
  userId: user.id,
  email: user.email,
  marketingEmailsOptIn: user.marketingEmailsOptIn,
  ...(user.merchantId ? { merchantId: user.merchantId } : {}),
  ...(user.merchantName ? { merchantName: user.merchantName } : {}),
  ...(user.avatarDataUrl ? { avatarDataUrl: user.avatarDataUrl } : {}),
});

const toAuthResponse = (
  status: 200 | 201,
  { user, token }: { user: AuthResult['user']; token: string },
  config: { jwtTtlSeconds: number; testUserTtlSeconds: number },
  responseHeaders: Headers
) => {
  const ttlSeconds = getTtlSeconds(user, config);
  responseHeaders.set('Set-Cookie', createAuthCookie(token, ttlSeconds));
  return {
    status,
    body: toUserProfileBody(user),
  };
};

const ensureMerchantCreditLineAccount = async (user: AuthResult['user']) => {
  const bankingDeps = await getBankingDependencies();
  const { repository, accountNumberGenerator, logger, metrics, config } =
    bankingDeps;

  const accounts = await repository.getAccountsByUserId(user.id);
  const hasCreditLine = accounts.some(
    account => account.accountType === 'CREDIT_LINE'
  );

  if (hasCreditLine) {
    return;
  }

  await createAccount(
    {
      ownerId: user.id,
      name: 'Merchant Credit Line',
      isTest: user.isTest,
      accountType: 'CREDIT_LINE',
      creditLimitMinor: config.defaultMerchantCreditLimitMinor,
    },
    {
      repository,
      accountNumberGenerator,
      logger,
      metrics,
    }
  );
};

const finalizeMerchantSignUp = async (
  result: AuthResult,
  isMerchantSignup: boolean,
  config: { jwtTtlSeconds: number; testUserTtlSeconds: number },
  responseHeaders: Headers
) => {
  if (isMerchantSignup) {
    await ensureMerchantCreditLineAccount(result.user);
  }
  return toAuthResponse(201, result, config, responseHeaders);
};

export const signUpHandler = async (
  { body, query }: ServerInferRequest<(typeof bankApiContract)['signUp']>,
  { responseHeaders }: { responseHeaders: Headers }
) => {
  const deps = await getDependencies();
  const { logger, config } = deps;
  const isMerchantSignup = Boolean(body.merchantId);
  const merchantName = body.merchantName?.trim();

  if (isMerchantSignup && !merchantName) {
    return {
      status: 400 as const,
      body: {
        error: 'VALIDATION_ERROR',
        message: 'Merchant name is required when signing up as a merchant',
      },
    };
  }

  try {
    const result = await signUp(
      {
        email: body.email,
        isTest: query?.dev === 'true',
        marketingEmailsOptIn: body.marketingEmailsOptIn,
        merchantId: body.merchantId,
        merchantName,
        avatarDataUrl: body.avatarDataUrl,
      },
      deps
    );

    return finalizeMerchantSignUp(
      result,
      isMerchantSignup,
      config,
      responseHeaders
    );
  } catch (error: unknown) {
    logger.error('Sign-up failed', { error: String(error) });
    if (error instanceof UserAlreadyExistsError) {
      if (isMerchantSignup) {
        const result = await signIn({ email: body.email }, deps);
        return finalizeMerchantSignUp(
          result,
          isMerchantSignup,
          config,
          responseHeaders
        );
      }
      return toUserAlreadyExistsError(
        'A user with this email already exists. Please use a different email.'
      );
    }
    throw error;
  }
};

export const signInHandler = async (
  { body }: ServerInferRequest<(typeof bankApiContract)['signIn']>,
  { responseHeaders }: { responseHeaders: Headers }
) => {
  const deps = await getDependencies();
  const { logger, config } = deps;

  try {
    logger.debug('Signing in', { email: body.email });
    const result = await signIn(
      {
        email: body.email,
      },
      deps
    );
    logger.debug('Signed in', { userId: result.user.id });
    return toAuthResponse(200, result, config, responseHeaders);
  } catch (error: unknown) {
    logger.error('Sign-in failed', { error: String(error) });
    logger.debug('Sign-in failed', { email: body.email });
    if (error instanceof UserNotFoundError) {
      return toUnauthorizedResponse(
        'User not found. Please check the email and try again or sign up.'
      );
    }
    throw error;
  }
};

export const updateUserProfileHandler = async (
  { body }: ServerInferRequest<(typeof bankApiContract)['updateUserProfile']>,
  { request }: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const deps = await getDependencies();
  const { logger, userRepository } = deps;
  const { userId } = await extractAuthInfo(request);

  const hasUpdates =
    body.merchantName !== undefined || body.avatarDataUrl !== undefined;
  if (!hasUpdates) {
    return {
      status: 400 as const,
      body: {
        error: 'VALIDATION_ERROR',
        message: 'At least one profile field must be provided.',
      },
    };
  }

  try {
    const updatedUser = await userRepository.updateProfile(userId, {
      merchantName: body.merchantName,
      avatarDataUrl: body.avatarDataUrl,
    });

    return {
      status: 200 as const,
      body: toUserProfileBody({
        id: updatedUser.id,
        email: updatedUser.email,
        createdAt: updatedUser.createdAt.toISOString(),
        isTest: updatedUser.isTest,
        marketingEmailsOptIn: updatedUser.marketingEmailsOptIn,
        merchantId: updatedUser.merchantId,
        merchantName: updatedUser.merchantName,
        avatarDataUrl: updatedUser.avatarDataUrl,
      }),
    };
  } catch (error: unknown) {
    logger.error('Update profile failed', { error: String(error) });
    throw error;
  }
};
