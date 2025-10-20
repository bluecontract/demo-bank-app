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
  name: string;
  isTest?: boolean;
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
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      isTest: user.isTest,
    },
    token,
  };
}

export async function signUp(
  command: SignUpCommand,
  dependencies: SignUpDependencies
): Promise<AuthResult> {
  const { userRepository, jwtService, logger, metrics } = dependencies;

  const { name, isTest = false } = command;
  const timing = TimingUtils.startTiming(OPERATION_NAMES.AUTH.SIGN_UP);

  logger.info('User sign-up started', {
    userName: name,
    isTest,
    ...TimingUtils.createTimingMetadata(timing),
  });

  let savedUser: User | undefined;

  try {
    const user = new User({
      id: randomUUID(),
      name: name,
      createdAt: new Date(),
      isTest,
    });

    savedUser = await userRepository.save(user);

    const token = await jwtService.generateToken(
      savedUser.id,
      savedUser.isTest
    );

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
      userName: name,
      userId: savedUser.id,
      isTest,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return toAuthResult(savedUser, token);
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    if (error instanceof UserAlreadyExistsError) {
      logger.error('User sign-up failed', {
        userName: name,
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
        userName: name,
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
      userName: name,
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
