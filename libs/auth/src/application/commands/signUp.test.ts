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
    findByName: vi.fn(),
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
    const command: SignUpCommand = { name: 'john-doe', isTest: false };

    const mockUser = new User({
      id: 'user-123',
      name: 'john-doe',
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
    expect(result.user.name).toBe('john-doe');
    expect(result.user.isTest).toBe(false);
    expect(result.token).toBe(mockToken);
    expect(mockUserRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'john-doe',
        isTest: false,
      })
    );
    expect(mockJwtService.generateToken).toHaveBeenCalledWith(
      'user-123',
      false
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'User sign-up completed successfully',
      expect.objectContaining({
        userName: 'john-doe',
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
    const command: SignUpCommand = { name: 'test-user', isTest: true };

    const mockUser = new User({
      id: 'test-user-123',
      name: 'test-user',
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
    expect(result.user.name).toBe('test-user');
    expect(result.user.isTest).toBe(true);
    expect(result.token).toBe(mockToken);
    expect(mockUserRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-user',
        isTest: true,
      })
    );
    expect(mockJwtService.generateToken).toHaveBeenCalledWith(
      'test-user-123',
      true
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'TestUserSignUp',
      'Count',
      1
    );
  });

  it('should throw UserAlreadyExistsError when user already exists', async () => {
    // Given
    const command: SignUpCommand = { name: 'existing-user' };

    const userAlreadyExistsError = new UserAlreadyExistsError('existing-user');
    vi.mocked(mockUserRepository.save).mockRejectedValue(
      userAlreadyExistsError
    );

    // When & Then
    await expect(signUp(command, dependencies)).rejects.toThrow(
      new UserAlreadyExistsError('existing-user')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'User sign-up failed',
      expect.objectContaining({
        userName: 'existing-user',
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
    const command: SignUpCommand = { name: 'test-user' };

    const mockUser = new User({
      id: 'user-123',
      name: 'test-user',
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
        userName: 'test-user',
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
    const command: SignUpCommand = { name: 'test-user' };

    const mockUser = new User({
      id: 'user-123',
      name: 'test-user',
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
        userName: 'test-user',
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
