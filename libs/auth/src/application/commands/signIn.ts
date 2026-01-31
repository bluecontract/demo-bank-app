import {
  UserNotFoundError,
  TokenGenerationError,
} from '../../infrastructure/errors';
import { AuthError } from '../errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { AuthResult } from '../dtos';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import { User } from '../../domain/entities/User';

export interface SignInCommand {
  email: string;
}

export interface SignInDependencies {
  userRepository: UserRepository;
  jwtService: JwtService;
  logger: Logger;
  metrics: Metrics;
}

function toAuthResult(user: User, token: string): AuthResult {
  return {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      isTest: user.isTest,
      marketingEmailsOptIn: user.marketingEmailsOptIn,
      merchantId: user.merchantId,
    },
    token,
  };
}

export async function signIn(
  command: SignInCommand,
  dependencies: SignInDependencies
): Promise<AuthResult> {
  const { userRepository, jwtService, logger, metrics } = dependencies;

  const { email } = command;
  const timing = TimingUtils.startTiming(OPERATION_NAMES.AUTH.SIGN_IN);

  logger.info('User sign-in started', {
    userEmail: email,
    ...TimingUtils.createTimingMetadata(timing),
  });

  let foundUser: Awaited<ReturnType<typeof userRepository.findByEmail>> = null;

  try {
    foundUser = await userRepository.findByEmail(email);

    if (!foundUser) {
      const failedTiming = TimingUtils.endTiming(timing);
      logger.error('User sign-in failed', {
        userEmail: email,
        error: 'User not found',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_IN_ERROR,
        METRIC_UNITS.COUNT,
        1
      );
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_IN_FAILURE_DURATION,
        METRIC_UNITS.MILLISECONDS,
        failedTiming.duration || 0
      );
      throw new UserNotFoundError(email);
    }

    const token = await jwtService.generateToken({
      userId: foundUser.id,
      email: foundUser.email,
      isTest: foundUser.isTest,
    });

    const completedTiming = TimingUtils.endTiming(timing);

    const metricName = foundUser.isTest
      ? METRIC_NAMES.AUTH.TEST_USER_SIGN_IN
      : METRIC_NAMES.AUTH.USER_SIGN_IN;
    metrics.addMetric(metricName, METRIC_UNITS.COUNT, 1);
    metrics.addMetric(
      METRIC_NAMES.AUTH.USER_SIGN_IN_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger.info('User sign-in completed successfully', {
      userEmail: email,
      userId: foundUser.id,
      isTest: foundUser.isTest,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return toAuthResult(foundUser, token);
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    if (error instanceof UserNotFoundError) {
      throw error;
    }

    if (error instanceof TokenGenerationError) {
      logger.error('JWT generation failed during sign-in', {
        userEmail: email,
        userId: foundUser?.id || 'unknown',
        error: error.message,
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_IN_JWT_ERROR,
        METRIC_UNITS.COUNT,
        1
      );
      throw error;
    }

    logger.error('Unexpected error during user sign-in', {
      userEmail: email,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics.addMetric(
      METRIC_NAMES.AUTH.USER_SIGN_IN_UNKNOWN_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw new AuthError(
      'Unexpected error during user sign-in',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
