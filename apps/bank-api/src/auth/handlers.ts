import {
  signUp,
  signIn,
  type AuthResult,
  UserNotFoundError,
  UserAlreadyExistsError,
} from '@demo-bank-app/auth';

import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';

import { getDependencies } from './dependencies';
import { ServerInferRequest } from '@ts-rest/core';
import { toUnauthorizedResponse } from '../shared/errors';
import { toUserAlreadyExistsError } from './errors';

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
    body: {
      userId: user.id,
      email: user.email,
      marketingEmailsOptIn: user.marketingEmailsOptIn,
    },
  };
};

export const signUpHandler = async (
  { body, query }: ServerInferRequest<(typeof bankApiContract)['signUp']>,
  { responseHeaders }: { responseHeaders: Headers }
) => {
  const deps = await getDependencies();
  const { logger, config } = deps;

  try {
    const result = await signUp(
      {
        email: body.email,
        isTest: query?.dev === 'true',
        marketingEmailsOptIn: body.marketingEmailsOptIn,
      },
      deps
    );
    return toAuthResponse(201, result, config, responseHeaders);
  } catch (error: unknown) {
    logger.error('Sign-up failed', { error: String(error) });
    if (error instanceof UserAlreadyExistsError) {
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
