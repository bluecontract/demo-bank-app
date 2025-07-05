import { UserNotFoundError } from '../../domain/errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';

export interface SignInCommand {
  name: string;
}

export interface SignInResult {
  user: {
    id: string;
    name: string;
    createdAt: string;
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

  logger.info('User sign-in started', {
    userName: name,
  });

  let foundUser: Awaited<ReturnType<typeof userRepository.findByName>> = null;

  try {
    foundUser = await userRepository.findByName(name);

    if (!foundUser) {
      logger.error('User sign-in failed', {
        userName: name,
        error: 'User not found',
      });
      metrics.addMetric('UserSignInError', 'Count', 1);
      throw new UserNotFoundError(name);
    }

    const token = await jwtService.generateToken(
      foundUser.id,
      foundUser.isTest
    );

    const metricName = foundUser.isTest ? 'TestUserSignIn' : 'UserSignIn';
    metrics.addMetric(metricName, 'Count', 1);

    logger.info('User sign-in completed successfully', {
      userName: name,
      userId: foundUser.id,
      isTest: foundUser.isTest,
    });

    return {
      user: {
        id: foundUser.id,
        name: foundUser.name,
        createdAt: foundUser.createdAt.toISOString(),
      },
      token,
    };
  } catch (error: unknown) {
    if (error instanceof UserNotFoundError) {
      throw error;
    }

    if (error instanceof Error && error.message.includes('JWT')) {
      logger.error('JWT generation failed during sign-in', {
        userName: name,
        userId: foundUser?.id || 'unknown',
        error: error.message,
      });
      throw error;
    }

    logger.error('User sign-in failed', {
      userName: name,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}
