import { User, UserName } from '../../domain/entities/User';
import { UserAlreadyExistsError } from '../../domain/errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';

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

  logger.info('User sign-up started', {
    userName: name,
    isTest,
  });

  let savedUser: User | undefined;

  try {
    const user = User.create(name as UserName, isTest);

    savedUser = await userRepository.save(user);

    const token = await jwtService.generateToken(
      savedUser.id,
      savedUser.isTest
    );

    const metricName = isTest ? 'TestUserSignUp' : 'UserSignUp';
    metrics.addMetric(metricName, 'Count', 1);

    logger.info('User sign-up completed successfully', {
      userName: name,
      userId: savedUser.id,
      isTest,
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
    if (error instanceof UserAlreadyExistsError) {
      logger.error('User sign-up failed', {
        userName: name,
        error: 'User already exists',
      });
      metrics.addMetric('UserSignUpError', 'Count', 1);
      throw error;
    }

    if (error instanceof Error && error.message.includes('JWT')) {
      logger.error('JWT generation failed during sign-up', {
        userName: name,
        userId: savedUser?.id || 'unknown',
        error: error.message,
      });
      throw error;
    }

    logger.error('User sign-up failed', {
      userName: name,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}
