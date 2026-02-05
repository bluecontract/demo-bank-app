import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIn, type SignInCommand, type SignInDependencies } from './signIn';
import { User } from '../../domain/entities/User';
import {
  UserNotFoundError,
  TokenGenerationError,
} from '../../infrastructure/errors';
import { AuthError } from '../errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { AuthResult } from '../dtos';
import { randomUUID } from 'crypto';

const mockUserRepository: UserRepository = {
  save: vi.fn(),
  findById: vi.fn(),
  findByEmail: vi.fn(),
  updateProfile: vi.fn(),
};

const mockJwtService: JwtService = {
  generateToken: vi.fn(),
  verifyToken: vi.fn(),
};

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  setCorrelationId: vi.fn(),
  addContext: vi.fn(),
};

const mockMetrics: Metrics = {
  addMetric: vi.fn(),
  addMetadata: vi.fn(),
  publishStoredMetrics: vi.fn(),
  setDefaultDimensions: vi.fn(),
};

const dependencies: SignInDependencies = {
  userRepository: mockUserRepository,
  jwtService: mockJwtService,
  logger: mockLogger,
  metrics: mockMetrics,
};

describe('signIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs in an existing user', async () => {
    const command: SignInCommand = {
      email: 'john.doe@example.com',
    };

    const mockUser = new User({
      id: randomUUID(),
      email: 'john.doe@example.com',
      isTest: false,
      createdAt: new Date(),
      marketingEmailsOptIn: true,
      merchantId: 'merchant-123',
    });
    const mockToken = 'jwt-token-123';

    vi.mocked(mockUserRepository.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

    const result = await signIn(command, dependencies);

    expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(
      'john.doe@example.com'
    );
    expect(mockJwtService.generateToken).toHaveBeenCalledWith({
      userId: mockUser.id,
      email: 'john.doe@example.com',
      isTest: mockUser.isTest,
    });
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignIn',
      'Count',
      1
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'User sign-in completed successfully',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        userId: mockUser.id,
        isTest: false,
      })
    );

    const expectedResult: AuthResult = {
      user: {
        id: mockUser.id,
        email: 'john.doe@example.com',
        createdAt: mockUser.createdAt.toISOString(),
        isTest: false,
        marketingEmailsOptIn: true,
        merchantId: 'merchant-123',
      },
      token: mockToken,
    };

    expect(result).toEqual(expectedResult);
  });

  it('signs in a test user', async () => {
    const command: SignInCommand = {
      email: 'test.user@example.com',
    };

    const mockUser = new User({
      id: randomUUID(),
      email: 'test.user@example.com',
      isTest: true,
      createdAt: new Date(),
      marketingEmailsOptIn: false,
    });
    const mockToken = 'jwt-token-test';

    vi.mocked(mockUserRepository.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

    const result = await signIn(command, dependencies);

    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'TestUserSignIn',
      'Count',
      1
    );
    expect(result.user.id).toBe(mockUser.id);
    expect(result.user.email).toBe('test.user@example.com');
    expect(result.user.createdAt).toBe(mockUser.createdAt.toISOString());
    expect(result.user.isTest).toBe(true);
    expect(result.user.marketingEmailsOptIn).toBe(false);
    expect(result.token).toBe(mockToken);
  });

  it('throws UserNotFoundError when user does not exist', async () => {
    const command: SignInCommand = {
      email: 'missing.user@example.com',
    };

    vi.mocked(mockUserRepository.findByEmail).mockResolvedValue(null);

    await expect(signIn(command, dependencies)).rejects.toThrow(
      UserNotFoundError
    );
    await expect(signIn(command, dependencies)).rejects.toThrow(
      "User with email 'missing.user@example.com' not found"
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'User sign-in failed',
      expect.objectContaining({
        userEmail: 'missing.user@example.com',
        error: 'User not found',
      })
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignInError',
      'Count',
      1
    );
  });

  it('wraps repository errors', async () => {
    const command: SignInCommand = {
      email: 'john.doe@example.com',
    };

    const repositoryError = new Error('Database connection failed');
    vi.mocked(mockUserRepository.findByEmail).mockRejectedValue(
      repositoryError
    );

    await expect(signIn(command, dependencies)).rejects.toThrow(
      new AuthError('Unexpected error during user sign-in', repositoryError)
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unexpected error during user sign-in',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        error: 'Database connection failed',
      })
    );
  });

  it('propagates JWT generation errors', async () => {
    const command: SignInCommand = {
      email: 'john.doe@example.com',
    };

    const mockUser = new User({
      id: randomUUID(),
      email: 'john.doe@example.com',
      isTest: false,
      createdAt: new Date(),
      marketingEmailsOptIn: true,
    });
    const jwtError = new TokenGenerationError(mockUser.id);

    vi.mocked(mockUserRepository.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockRejectedValue(jwtError);

    await expect(signIn(command, dependencies)).rejects.toThrow(
      new TokenGenerationError(mockUser.id)
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      'JWT generation failed during sign-in',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        userId: mockUser.id,
        error: `Failed to generate token for user '${mockUser.id}'`,
      })
    );
  });

  it('handles unknown errors', async () => {
    const command: SignInCommand = {
      email: 'john.doe@example.com',
    };

    const unknownError = new Error('Something went wrong');
    vi.mocked(mockUserRepository.findByEmail).mockRejectedValue(unknownError);

    await expect(signIn(command, dependencies)).rejects.toThrow(
      new AuthError('Unexpected error during user sign-in', unknownError)
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unexpected error during user sign-in',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        error: 'Something went wrong',
      })
    );
  });

  it('logs sign-in start and success', async () => {
    const command: SignInCommand = {
      email: 'john.doe@example.com',
    };

    const mockUser = new User({
      id: randomUUID(),
      email: 'john.doe@example.com',
      isTest: false,
      createdAt: new Date(),
      marketingEmailsOptIn: true,
    });
    const mockToken = 'jwt-token-123';

    vi.mocked(mockUserRepository.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

    await signIn(command, dependencies);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'User sign-in started',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
      })
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'User sign-in completed successfully',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        userId: mockUser.id,
      })
    );
  });
});
