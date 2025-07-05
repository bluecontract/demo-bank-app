import { UserNotFoundError } from '../../domain/errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { TimingUtils } from '@demo-blue/shared-observability';

export interface SignInCommand {
  name: string;
}

export interface SignInResult {
  user: {
    id: string;
    name: string;
    createdAt: string;
    isTest: boolean;
  };
  token: string;
}

export interface SignInDependencies {
  userRepository: UserRepository;
  jwtService: JwtService;
  logger: Logger;
  metrics: Metrics;
}

export async function signIn(
  command: SignInCommand,
  dependencies: SignInDependencies
): Promise<SignInResult> {
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

    return {
      user: {
        id: foundUser.id,
        name: foundUser.name,
        createdAt: foundUser.createdAt.toISOString(),
        isTest: foundUser.isTest,
      },
      token,
    };
  } catch (error: unknown) {
    if (error instanceof UserNotFoundError) {
      throw error;
    }

    const failedTiming = TimingUtils.endTiming(timing);

    if (error instanceof Error && error.message.includes('JWT')) {
      logger.error('JWT generation failed during sign-in', {
        userName: name,
        userId: foundUser?.id || 'unknown',
        error: error.message,
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric('UserSignInJwtError', 'Count', 1);
      throw error;
    }

    logger.error('User sign-in failed', {
      userName: name,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics.addMetric('UserSignInUnknownError', 'Count', 1);

    throw error;
  }
}
