import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signIn, SignInCommand, SignInDependencies } from './signIn';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { User, UserName } from '../../domain/entities/User';
import { UserNotFoundError } from '../../domain/errors';

// Mock dependencies
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

  describe('execute', () => {
    it('should successfully sign in an existing user', async () => {
      // Given
      const command: SignInCommand = {
        name: 'johndoe',
      };

      const mockUser = User.create('johndoe' as UserName, false);
      const mockToken = 'jwt-token-123';

      vi.mocked(mockUserRepository.findByName).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

      // When
      const result = await signIn(command, dependencies);

      // Then
      expect(mockUserRepository.findByName).toHaveBeenCalledWith('johndoe');
      expect(mockJwtService.generateToken).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.isTest
      );
      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'UserSignIn',
        'Count',
        1
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User sign-in completed successfully',
        expect.objectContaining({
          userName: 'johndoe',
          userId: mockUser.id,
          isTest: false,
        })
      );

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          name: 'johndoe',
          createdAt: mockUser.createdAt.toISOString(),
          isTest: false,
        },
        token: mockToken,
      });
    });

    it('should successfully sign in a test user', async () => {
      // Given
      const command: SignInCommand = {
        name: 'test-user',
      };

      const mockUser = User.create('test-user' as UserName, true);
      const mockToken = 'jwt-token-test';

      vi.mocked(mockUserRepository.findByName).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

      // When
      const result = await signIn(command, dependencies);

      // Then
      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'TestUserSignIn',
        'Count',
        1
      );
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.name).toBe('test-user');
      expect(result.user.createdAt).toBe(mockUser.createdAt.toISOString());
      expect(result.user.isTest).toBe(true);
      expect(result.token).toBe(mockToken);
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      // Given
      const command: SignInCommand = {
        name: 'nonexistent-user',
      };

      vi.mocked(mockUserRepository.findByName).mockResolvedValue(null);

      // When & Then
      await expect(signIn(command, dependencies)).rejects.toThrow(
        UserNotFoundError
      );
      await expect(signIn(command, dependencies)).rejects.toThrow(
        "User with name 'nonexistent-user' not found"
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-in failed',
        expect.objectContaining({
          userName: 'nonexistent-user',
          error: 'User not found',
        })
      );
      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'UserSignInError',
        'Count',
        1
      );
    });

    it('should handle repository errors gracefully', async () => {
      // Given
      const command: SignInCommand = {
        name: 'johndoe',
      };

      const error = new Error('Database connection failed');
      vi.mocked(mockUserRepository.findByName).mockRejectedValue(error);

      // When & Then
      await expect(signIn(command, dependencies)).rejects.toThrow(
        'Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-in failed',
        expect.objectContaining({
          userName: 'johndoe',
          error: 'Database connection failed',
        })
      );
    });

    it('should handle JWT service errors gracefully', async () => {
      // Given
      const command: SignInCommand = {
        name: 'johndoe',
      };

      const mockUser = User.create('johndoe' as UserName, false);
      const jwtError = new Error('JWT generation failed');

      vi.mocked(mockUserRepository.findByName).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockRejectedValue(jwtError);

      // When & Then
      await expect(signIn(command, dependencies)).rejects.toThrow(
        'JWT generation failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'JWT generation failed during sign-in',
        expect.objectContaining({
          userName: 'johndoe',
          userId: mockUser.id,
          error: 'JWT generation failed',
        })
      );
    });

    it('should handle unknown errors gracefully', async () => {
      // Given
      const command: SignInCommand = {
        name: 'johndoe',
      };

      const unknownError = new Error('Something went wrong');
      vi.mocked(mockUserRepository.findByName).mockRejectedValue(unknownError);

      // When & Then
      await expect(signIn(command, dependencies)).rejects.toThrow(unknownError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-in failed',
        expect.objectContaining({
          userName: 'johndoe',
          error: 'Something went wrong',
        })
      );
    });

    it('should log sign-in start and success', async () => {
      // Given
      const command: SignInCommand = {
        name: 'johndoe',
      };

      const mockUser = User.create('johndoe' as UserName, false);
      const mockToken = 'jwt-token-123';

      vi.mocked(mockUserRepository.findByName).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

      // When
      await signIn(command, dependencies);

      // Then
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User sign-in started',
        expect.objectContaining({
          userName: 'johndoe',
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User sign-in completed successfully',
        expect.objectContaining({
          userName: 'johndoe',
          userId: mockUser.id,
          isTest: false,
        })
      );
    });
  });
});
