import {
  UserAlreadyExistsError,
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
import { randomUUID } from 'crypto';

export interface SignUpCommand {
  email: string;
  isTest?: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: string;
}

export interface SignUpDependencies {
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
    },
    token,
  };
}

export async function signUp(
  command: SignUpCommand,
  dependencies: SignUpDependencies
): Promise<AuthResult> {
  const { userRepository, jwtService, logger, metrics } = dependencies;

  const { email, isTest = false, marketingEmailsOptIn, merchantId } = command;
  const timing = TimingUtils.startTiming(OPERATION_NAMES.AUTH.SIGN_UP);

  logger.info('User sign-up started', {
    userEmail: email,
    isTest,
    ...TimingUtils.createTimingMetadata(timing),
  });

  let savedUser: User | undefined;

  try {
    const user = new User({
      id: randomUUID(),
      email,
      createdAt: new Date(),
      isTest,
      marketingEmailsOptIn,
      merchantId,
    });

    savedUser = await userRepository.save(user);

    const token = await jwtService.generateToken({
      userId: savedUser.id,
      email: savedUser.email,
      isTest: savedUser.isTest,
    });

    const completedTiming = TimingUtils.endTiming(timing);

    const metricName = isTest
      ? METRIC_NAMES.AUTH.TEST_USER_SIGN_UP
      : METRIC_NAMES.AUTH.USER_SIGN_UP;
    metrics.addMetric(metricName, METRIC_UNITS.COUNT, 1);
    metrics.addMetric(
      METRIC_NAMES.AUTH.USER_SIGN_UP_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger.info('User sign-up completed successfully', {
      userEmail: email,
      userId: savedUser.id,
      isTest,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return toAuthResult(savedUser, token);
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    if (error instanceof UserAlreadyExistsError) {
      logger.error('User sign-up failed', {
        userEmail: email,
        error: 'User already exists',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_UP_ERROR,
        METRIC_UNITS.COUNT,
        1
      );
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_UP_FAILURE_DURATION,
        METRIC_UNITS.MILLISECONDS,
        failedTiming.duration || 0
      );
      throw error;
    }

    if (error instanceof TokenGenerationError) {
      logger.error('JWT generation failed during sign-up', {
        userEmail: email,
        userId: savedUser?.id || 'unknown',
        error: error.message,
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric(
        METRIC_NAMES.AUTH.USER_SIGN_UP_JWT_ERROR,
        METRIC_UNITS.COUNT,
        1
      );
      throw error;
    }

    logger.error('Unexpected error during user sign-up', {
      userEmail: email,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics.addMetric(
      METRIC_NAMES.AUTH.USER_SIGN_UP_UNKNOWN_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw new AuthError(
      'Unexpected error during user sign-up',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
