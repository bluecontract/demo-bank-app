import { User, UserName } from '../../domain/entities/User';
import { UserAlreadyExistsError } from '../../domain/errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { TimingUtils } from '@demo-blue/shared-observability';

export interface SignUpCommand {
  name: string;
  isTest?: boolean;
}

export interface SignUpResult {
  user: {
    id: string;
    name: string;
    createdAt: string;
    isTest: boolean;
  };
  token: string;
}

export interface SignUpDependencies {
  userRepository: UserRepository;
  jwtService: JwtService;
  logger: Logger;
  metrics: Metrics;
}

export async function signUp(
  command: SignUpCommand,
  dependencies: SignUpDependencies
): Promise<SignUpResult> {
  const { userRepository, jwtService, logger, metrics } = dependencies;

  const { name, isTest = false } = command;
  const timing = TimingUtils.startTiming('user-signup');

  logger.info('User sign-up started', {
    userName: name,
    isTest,
    ...TimingUtils.createTimingMetadata(timing),
  });

  let savedUser: User | undefined;

  try {
    const user = User.create(name as UserName, isTest);

    savedUser = await userRepository.save(user);

    const token = await jwtService.generateToken(
      savedUser.id,
      savedUser.isTest
    );

    const completedTiming = TimingUtils.endTiming(timing);

    const metricName = isTest ? 'TestUserSignUp' : 'UserSignUp';
    metrics.addMetric(metricName, 'Count', 1);
    metrics.addMetric(
      'UserSignUpDuration',
      'Milliseconds',
      completedTiming.duration || 0
    );

    logger.info('User sign-up completed successfully', {
      userName: name,
      userId: savedUser.id,
      isTest,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return {
      user: {
        id: savedUser.id,
        name: savedUser.name,
        createdAt: savedUser.createdAt.toISOString(),
        isTest: savedUser.isTest,
      },
      token,
    };
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    if (error instanceof UserAlreadyExistsError) {
      logger.error('User sign-up failed', {
        userName: name,
        error: 'User already exists',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric('UserSignUpError', 'Count', 1);
      metrics.addMetric(
        'UserSignUpFailureDuration',
        'Milliseconds',
        failedTiming.duration || 0
      );
      throw error;
    }

    if (error instanceof Error && error.message.includes('JWT')) {
      logger.error('JWT generation failed during sign-up', {
        userName: name,
        userId: savedUser?.id || 'unknown',
        error: error.message,
        ...TimingUtils.createTimingMetadata(failedTiming),
      });
      metrics.addMetric('UserSignUpJwtError', 'Count', 1);
      throw error;
    }

    logger.error('User sign-up failed', {
      userName: name,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics.addMetric('UserSignUpUnknownError', 'Count', 1);

    throw error;
  }
}
