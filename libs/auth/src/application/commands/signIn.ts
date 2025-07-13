import {
  UserNotFoundError,
  TokenGenerationError,
} from '../../infrastructure/errors';
import { AuthError } from '../errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { AuthResult } from '../dtos';
import { TimingUtils } from '@demo-blue/shared-observability';
import { User } from '../../domain/entities/User';

export interface SignInCommand {
  name: string;
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
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      isTest: user.isTest,
    },
    token,
  };
}

export async function signIn(
  command: SignInCommand,
  dependencies: SignInDependencies
): Promise<AuthResult> {
  const { userRepository, jwtService, logger, metrics } = dependencies;

  const { name } = command;
  const timing = TimingUtils.startTiming('user-signin');

  logger.info('User sign-in started', {
    userName: name,
    ...TimingUtils.createTimingMetadata(timing),
  });

  let foundUser: Awaited<ReturnType<typeof userRepository.findByName>> = null;

  try {
    foundUser = await userRepository.findByName(name);

    if (!foundUser) {
      const failedTiming = TimingUtils.endTiming(timing);
      logger.error('User sign-in failed', {
        userName: name,
        error: 'User not found',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric('UserSignInError', 'Count', 1);
      metrics.addMetric(
        'UserSignInFailureDuration',
        'Milliseconds',
        failedTiming.duration || 0
      );
      throw new UserNotFoundError(name);
    }

    const token = await jwtService.generateToken(
      foundUser.id,
      foundUser.isTest
    );

    const completedTiming = TimingUtils.endTiming(timing);

    const metricName = foundUser.isTest ? 'TestUserSignIn' : 'UserSignIn';
    metrics.addMetric(metricName, 'Count', 1);
    metrics.addMetric(
      'UserSignInDuration',
      'Milliseconds',
      completedTiming.duration || 0
    );

    logger.info('User sign-in completed successfully', {
      userName: name,
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
        userName: name,
        userId: foundUser?.id || 'unknown',
        error: error.message,
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric('UserSignInJwtError', 'Count', 1);
      throw error;
    }

    logger.error('Unexpected error during user sign-in', {
      userName: name,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics.addMetric('UserSignInUnknownError', 'Count', 1);

    throw new AuthError(
      'Unexpected error during user sign-in',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
