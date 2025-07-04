import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signUp, SignUpCommand, SignUpDependencies } from './signUp';
import type { UserRepository, JwtService, Logger, Metrics } from '../ports';
import { User, UserName } from '../../domain/entities/User';
import { UserAlreadyExistsError } from '../../domain/errors';

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

const dependencies: SignUpDependencies = {
  userRepository: mockUserRepository,
  jwtService: mockJwtService,
  logger: mockLogger,
  metrics: mockMetrics,
};

describe('signUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('should successfully sign up a new user', async () => {
      const command: SignUpCommand = {
        name: 'johndoe',
        isTest: false,
      };

      const mockUser = User.create('johndoe' as UserName, false);
      const mockToken = 'jwt-token-123';

      vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

      const result = await signUp(command, dependencies);

      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'johndoe',
          isTest: false,
        })
      );
      expect(mockJwtService.generateToken).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.isTest
      );
      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'UserSignUp',
        'Count',
        1
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User sign-up completed successfully',
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

    it('should successfully sign up a test user', async () => {
      const command: SignUpCommand = {
        name: 'test-user',
        isTest: true,
      };

      const mockUser = User.create('test-user' as UserName, true);
      const mockToken = 'jwt-token-test';

      vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockResolvedValue(mockToken);

      const result = await signUp(command, dependencies);

      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'TestUserSignUp',
        'Count',
        1
      );
      expect(result.user.isTest).toBe(true);
    });

    it('should throw UserAlreadyExistsError when user already exists', async () => {
      const command: SignUpCommand = {
        name: 'existinguser',
      };

      const error = new UserAlreadyExistsError('existinguser');
      vi.mocked(mockUserRepository.save).mockRejectedValue(error);

      await expect(signUp(command, dependencies)).rejects.toThrow(
        UserAlreadyExistsError
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-up failed',
        expect.objectContaining({
          userName: 'existinguser',
          error: 'User already exists',
        })
      );
      expect(mockMetrics.addMetric).toHaveBeenCalledWith(
        'UserSignUpError',
        'Count',
        1
      );
    });

    it('should handle repository errors gracefully', async () => {
      const command: SignUpCommand = {
        name: 'johndoe',
      };

      const error = new Error('Database connection failed');
      vi.mocked(mockUserRepository.save).mockRejectedValue(error);

      await expect(signUp(command, dependencies)).rejects.toThrow(
        'Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-up failed',
        expect.objectContaining({
          userName: 'johndoe',
          error: 'Database connection failed',
        })
      );
    });

    it('should handle JWT service errors gracefully', async () => {
      const command: SignUpCommand = {
        name: 'johndoe',
      };

      const mockUser = User.create('johndoe' as UserName, false);
      const jwtError = new Error('JWT generation failed');

      vi.mocked(mockUserRepository.save).mockResolvedValue(mockUser);
      vi.mocked(mockJwtService.generateToken).mockRejectedValue(jwtError);

      await expect(signUp(command, dependencies)).rejects.toThrow(
        'JWT generation failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'JWT generation failed during sign-up',
        expect.objectContaining({
          userName: 'johndoe',
          userId: mockUser.id,
          error: 'JWT generation failed',
        })
      );
    });

    it('should handle unknown errors gracefully', async () => {
      const command: SignUpCommand = {
        name: 'johndoe',
      };

      const unknownError = new Error('Something went wrong');
      vi.mocked(mockUserRepository.save).mockRejectedValue(unknownError);

      await expect(signUp(command, dependencies)).rejects.toThrow(unknownError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User sign-up failed',
        expect.objectContaining({
          userName: 'johndoe',
          error: 'Something went wrong',
        })
      );
    });
  });
});
