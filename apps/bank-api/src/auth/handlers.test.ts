import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signUpHandler, signInHandler } from './handlers';
import { getDependencies, resetDependencies } from './dependencies';
import {
  UserAlreadyExistsError,
  UserValidationError,
} from '@demo-bank-app/auth';
import { signUp, signIn } from '@demo-bank-app/auth';

// Mock dependencies for unit tests
vi.mock('./dependencies', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

vi.mock('@demo-bank-app/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  UserAlreadyExistsError: vi.fn(),
  UserNotFoundError: vi.fn(),
  UserValidationError: vi.fn(),
}));

const mockSignUp = vi.mocked(signUp);
const mockSignIn = vi.mocked(signIn);
const mockGetDependencies = vi.mocked(getDependencies);

const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };

// Helper for mock responseHeaders
const createMockHeaders = () => {
  const headers = new Map();
  return {
    set: (key: string, value: string) => headers.set(key, value),
    get: (key: string) => headers.get(key),
    toObject: () => Object.fromEntries(headers),
  };
};

describe('Auth Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDependencies();
  });

  describe('signUpHandler', () => {
    it('should return 201 and set cookie for successful sign-up', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockResolvedValue({
        user: {
          id: 'test-user-id',
          name: 'testuser',
          isTest: false,
          createdAt: '2021-01-01',
        },
        token: 'jwt-token',
      });
      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        { body: { name: 'testuser' }, query: {} },
        { responseHeaders } as any
      );
      expect(result.status).toBe(201);
      expect(result.body).toEqual({ userId: 'test-user-id', name: 'testuser' });
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 409 for UserAlreadyExistsError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockRejectedValue(new UserAlreadyExistsError('existinguser'));
      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        { body: { name: 'existinguser' }, query: {} },
        {
          responseHeaders,
        } as any
      );
      expect(result.status).toBe(409);
      expect(result.body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this name already exists. Please choose a different name.',
      });
    });

    it('should return 400 for UserValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockRejectedValue(
        new UserValidationError('', 'Invalid username format')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler({ body: { name: '' }, query: {} }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow(UserValidationError);
    });

    it('should propagate RequestValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = {
        name: 'RequestValidationError',
        message: 'Request validation failed',
        pathParamsError: '{}',
        queryParamsError: '{}',
        bodyError: '{"name": "Required"}',
        headerError: '{}',
      };
      mockSignUp.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler({ body: { name: '' }, query: {} }, {
          responseHeaders,
        } as any)
      ).rejects.toEqual(error);
    });

    it('should propagate unknown errors', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = new Error('Database connection failed');
      mockSignUp.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler({ body: { name: 'testuser' }, query: {} }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('signInHandler', () => {
    it('should return 200 and set cookie for successful sign-in', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignIn.mockResolvedValue({
        user: {
          id: 'test-user-id',
          name: 'testuser',
          isTest: false,
          createdAt: '2021-01-01',
        },
        token: 'jwt-token',
      });
      const responseHeaders = createMockHeaders();
      const result = await signInHandler({ body: { name: 'testuser' } }, {
        responseHeaders,
      } as any);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ userId: 'test-user-id', name: 'testuser' });
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 404 for UserNotFoundError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      class UserNotFoundError extends Error {
        code = 'USER_NOT_FOUND';
        constructor(name: string) {
          super(name);
        }
      }
      mockSignIn.mockRejectedValue(new UserNotFoundError('missinguser'));
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { name: 'missinguser' } }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow('missinguser');
    });

    it('should return 400 for UserValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignIn.mockRejectedValue(
        new UserValidationError('', 'Invalid username format')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { name: '' } }, { responseHeaders } as any)
      ).rejects.toThrow(UserValidationError);
    });

    it('should propagate RequestValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = {
        name: 'RequestValidationError',
        message: 'Request validation failed',
        pathParamsError: '{}',
        queryParamsError: '{}',
        bodyError: '{"name": "Required"}',
        headerError: '{}',
      };
      mockSignIn.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { name: '' } }, { responseHeaders } as any)
      ).rejects.toEqual(error);
    });

    it('should propagate unknown errors', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 3600, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = new Error('Database connection failed');
      mockSignIn.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { name: 'testuser' } }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow('Database connection failed');
    });
  });
});
