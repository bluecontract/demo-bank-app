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
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockResolvedValue({
        user: {
          id: 'test-user-id',
          email: 'testuser@example.com',
          isTest: false,
          createdAt: '2021-01-01',
          marketingEmailsOptIn: true,
        },
        token: 'jwt-token',
      });
      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        {
          body: {
            email: 'testuser@example.com',
            marketingEmailsOptIn: true,
          },
          query: {},
        },
        { responseHeaders } as any
      );
      expect(result.status).toBe(201);
      expect(result.body).toEqual({
        userId: 'test-user-id',
        email: 'testuser@example.com',
        marketingEmailsOptIn: true,
      });
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 409 for UserAlreadyExistsError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockRejectedValue(
        new UserAlreadyExistsError('existinguser@example.com')
      );
      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        {
          body: {
            email: 'existinguser@example.com',
            marketingEmailsOptIn: true,
          },
          query: {},
        },
        {
          responseHeaders,
        } as any
      );
      expect(result.status).toBe(409);
      expect(result.body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this email already exists. Please use a different email.',
      });
    });

    it('should return 400 for UserValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockRejectedValue(
        new UserValidationError('', 'Invalid email format')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler(
          { body: { email: '', marketingEmailsOptIn: true }, query: {} },
          {
            responseHeaders,
          } as any
        )
      ).rejects.toThrow(UserValidationError);
    });

    it('should propagate RequestValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = {
        email: 'RequestValidationError',
        message: 'Request validation failed',
        pathParamsError: '{}',
        queryParamsError: '{}',
        bodyError: '{"email": "Required"}',
        headerError: '{}',
      };
      mockSignUp.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler(
          { body: { email: '', marketingEmailsOptIn: true }, query: {} },
          {
            responseHeaders,
          } as any
        )
      ).rejects.toEqual(error);
    });

    it('should propagate unknown errors', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = new Error('Database connection failed');
      mockSignUp.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler(
          {
            body: { email: 'testuser@example.com', marketingEmailsOptIn: true },
            query: {},
          },
          {
            responseHeaders,
          } as any
        )
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('signInHandler', () => {
    it('should return 200 and set cookie for successful sign-in', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignIn.mockResolvedValue({
        user: {
          id: 'test-user-id',
          email: 'testuser@example.com',
          isTest: false,
          createdAt: '2021-01-01',
          marketingEmailsOptIn: true,
        },
        token: 'jwt-token',
      });
      const responseHeaders = createMockHeaders();
      const result = await signInHandler(
        { body: { email: 'testuser@example.com' } },
        {
          responseHeaders,
        } as any
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        userId: 'test-user-id',
        email: 'testuser@example.com',
        marketingEmailsOptIn: true,
      });
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 404 for UserNotFoundError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      class UserNotFoundError extends Error {
        code = 'USER_NOT_FOUND';
        constructor(email: string) {
          super(email);
        }
      }
      mockSignIn.mockRejectedValue(
        new UserNotFoundError('missinguser@example.com')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { email: 'missinguser@example.com' } }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow('missinguser@example.com');
    });

    it('should return 400 for UserValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignIn.mockRejectedValue(
        new UserValidationError('', 'Invalid email format')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { email: '' } }, { responseHeaders } as any)
      ).rejects.toThrow(UserValidationError);
    });

    it('should propagate RequestValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = {
        email: 'RequestValidationError',
        message: 'Request validation failed',
        pathParamsError: '{}',
        queryParamsError: '{}',
        bodyError: '{"email": "Required"}',
        headerError: '{}',
      };
      mockSignIn.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { email: '' } }, { responseHeaders } as any)
      ).rejects.toEqual(error);
    });

    it('should propagate unknown errors', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = new Error('Database connection failed');
      mockSignIn.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signInHandler({ body: { email: 'testuser@example.com' } }, {
          responseHeaders,
        } as any)
      ).rejects.toThrow('Database connection failed');
    });
  });
});
