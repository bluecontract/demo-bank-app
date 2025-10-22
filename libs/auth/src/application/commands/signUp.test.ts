import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signUp } from './signUp';
import type { SignUpCommand, SignUpDependencies } from './signUp';
import { User } from '../../domain/entities/User';
import {
  TokenGenerationError,
  UserAlreadyExistsError,
} from '../../infrastructure/errors';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { AuthError } from '../errors';

describe('signUp', () => {
  const mockUserRepository: UserRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
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

  const dependencies: SignUpDependencies = {
    userRepository: mockUserRepository,
    jwtService: mockJwtService,
    logger: mockLogger,
    metrics: mockMetrics,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create and save a new user successfully', async () => {
    // Given
    const command: SignUpCommand = {
      email: 'john.doe@example.com',
      isTest: false,
    };

    const mockUser = new User({
      id: 'user-123',
      email: 'john.doe@example.com',
      createdAt: new Date(),
      isTest: false,
    });
    const mockToken = 'jwt-token-123';

    vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

    // When
    const result = await signUp(command, dependencies);

    // Then
    expect(result.user.id).toBe('user-123');
    expect(result.user.email).toBe('john.doe@example.com');
    expect(result.user.isTest).toBe(false);
    expect(result.token).toBe(mockToken);
    expect(mockUserRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'john.doe@example.com',
        isTest: false,
      })
    );
    expect(mockJwtService.generateToken).toHaveBeenCalledWith({
      userId: 'user-123',
      email: 'john.doe@example.com',
      isTest: false,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'User sign-up completed successfully',
      expect.objectContaining({
        userEmail: 'john.doe@example.com',
        userId: 'user-123',
        isTest: false,
      })
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignUp',
      'Count',
      1
    );
  });

  it('should create and save a test user successfully', async () => {
    // Given
    const command: SignUpCommand = {
      email: 'test.user@example.com',
      isTest: true,
    };

    const mockUser = new User({
      id: 'test-user-123',
      email: 'test.user@example.com',
      createdAt: new Date(),
      isTest: true,
    });
    const mockToken = 'jwt-token-test';

    vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

    // When
    const result = await signUp(command, dependencies);

    // Then
    expect(result.user.id).toBe('test-user-123');
    expect(result.user.email).toBe('test.user@example.com');
    expect(result.user.isTest).toBe(true);
    expect(result.token).toBe(mockToken);
    expect(mockUserRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test.user@example.com',
        isTest: true,
      })
    );
    expect(mockJwtService.generateToken).toHaveBeenCalledWith({
      userId: 'test-user-123',
      email: 'test.user@example.com',
      isTest: true,
    });
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'TestUserSignUp',
      'Count',
      1
    );
  });

  it('should throw UserAlreadyExistsError when user already exists', async () => {
    // Given
    const command: SignUpCommand = { email: 'existing.user@example.com' };

    const userAlreadyExistsError = new UserAlreadyExistsError(
      'existing.user@example.com'
    );
    vi.mocked(mockUserRepository.save).mockRejectedValue(
      userAlreadyExistsError
    );

    // When & Then
    await expect(signUp(command, dependencies)).rejects.toThrow(
      new UserAlreadyExistsError('existing.user@example.com')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'User sign-up failed',
      expect.objectContaining({
        userEmail: 'existing.user@example.com',
        error: 'User already exists',
      })
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignUpError',
      'Count',
      1
    );
  });

  it('should rethrow error when JWT generation fails', async () => {
    // Given
    const command: SignUpCommand = { email: 'test.user@example.com' };

    const mockUser = new User({
      id: 'user-123',
      email: 'test.user@example.com',
      createdAt: new Date(),
      isTest: false,
    });
    const jwtError = new TokenGenerationError('user-123');

    vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockRejectedValue(jwtError);

    // When & Then
    await expect(signUp(command, dependencies)).rejects.toThrow(
      new TokenGenerationError('user-123')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'JWT generation failed during sign-up',
      expect.objectContaining({
        userEmail: 'test.user@example.com',
        userId: 'user-123',
        error: "Failed to generate token for user 'user-123'",
      })
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignUpJwtError',
      'Count',
      1
    );
  });

  it('should throw AuthError when unexpected error occurs', async () => {
    // Given
    const command: SignUpCommand = { email: 'test.user@example.com' };

    const mockUser = new User({
      id: 'user-123',
      email: 'test.user@example.com',
      createdAt: new Date(),
      isTest: false,
    });
    const unexpectedError = new Error('Unexpected error');

    vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
    vi.mocked(mockJwtService.generateToken).mockRejectedValue(unexpectedError);

    // When & Then
    await expect(signUp(command, dependencies)).rejects.toThrow(
      new AuthError('Unexpected error during user sign-up', unexpectedError)
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unexpected error during user sign-up',
      expect.objectContaining({
        userEmail: 'test.user@example.com',
        error: 'Unexpected error',
      })
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'UserSignUpUnknownError',
      'Count',
      1
    );
  });
});
