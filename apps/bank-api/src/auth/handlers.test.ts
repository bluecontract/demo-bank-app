import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signUpHandler, signInHandler } from './handlers';
import { getDependencies, resetDependencies } from './dependencies';
import {
  UserAlreadyExistsError,
  UserNotFoundError,
  UserValidationError,
  signUp,
  signIn,
} from '@demo-bank-app/auth';
import { createAccount } from '@demo-bank-app/banking';
import { getDependencies as getBankingDependencies } from '../banking/dependencies';

// Mock dependencies for unit tests
vi.mock('./dependencies', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

vi.mock('../banking/dependencies', () => ({
  getDependencies: vi.fn(),
}));

vi.mock('@demo-bank-app/auth', async () => {
  const actual = await vi.importActual<typeof import('@demo-bank-app/auth')>(
    '@demo-bank-app/auth'
  );
  return {
    ...actual,
    signIn: vi.fn(),
    signUp: vi.fn(),
  };
});

vi.mock('@demo-bank-app/banking', () => ({
  createAccount: vi.fn(),
}));

const mockSignUp = vi.mocked(signUp);
const mockSignIn = vi.mocked(signIn);
const mockGetDependencies = vi.mocked(getDependencies);
const mockGetBankingDependencies = vi.mocked(getBankingDependencies);
const mockCreateAccount = vi.mocked(createAccount);

const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
const mockMerchantDirectoryRepository = {
  upsertMerchantProfile: vi.fn(),
};

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
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
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

    it('should forward merchantId when provided', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockGetBankingDependencies.mockResolvedValueOnce({
        repository: { getAccountsByUserId: vi.fn().mockResolvedValue([]) },
        accountNumberGenerator: {},
        logger: mockLogger,
        metrics: {},
        config: { defaultMerchantCreditLimitMinor: 500_000 },
      } as any);
      mockCreateAccount.mockResolvedValue({} as any);
      mockSignUp.mockResolvedValue({
        user: {
          id: 'merchant-user-id',
          email: 'merchant@example.com',
          merchantName: 'Merchant Demo',
          isTest: false,
          createdAt: '2021-01-01',
          marketingEmailsOptIn: true,
          merchantId: 'merchant-123',
        },
        token: 'jwt-token',
      });
      const responseHeaders = createMockHeaders();

      const result = await signUpHandler(
        {
          body: {
            email: 'merchant@example.com',
            merchantName: 'Merchant Demo',
            marketingEmailsOptIn: true,
            merchantId: 'merchant-123',
          },
          query: {},
        },
        { responseHeaders } as any
      );

      expect(result.body).toMatchObject({
        userId: 'merchant-user-id',
        email: 'merchant@example.com',
        merchantName: 'Merchant Demo',
        marketingEmailsOptIn: true,
        merchantId: 'merchant-123',
      });
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'merchant@example.com',
          merchantName: 'Merchant Demo',
          marketingEmailsOptIn: true,
          merchantId: 'merchant-123',
        }),
        expect.anything()
      );
      expect(mockCreateAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'merchant-user-id',
          accountType: 'CREDIT_LINE',
          creditLimitMinor: 500_000,
        }),
        expect.anything()
      );
      expect(
        mockMerchantDirectoryRepository.upsertMerchantProfile
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'merchant-123',
          name: 'Merchant Demo',
          logoUrl: undefined,
          ownerUserId: 'merchant-user-id',
        })
      );
    });

    it('should return 409 for UserAlreadyExistsError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
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

    it('should recover merchant signup when user already exists', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
      };
      const mockRepository = {
        getAccountsByUserId: vi.fn().mockResolvedValue([]),
      };

      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockGetBankingDependencies.mockResolvedValueOnce({
        repository: mockRepository,
        accountNumberGenerator: {},
        logger: mockLogger,
        metrics: {},
        config: { defaultMerchantCreditLimitMinor: 500_000 },
      } as any);

      mockSignUp.mockRejectedValue(
        new UserAlreadyExistsError('merchant@example.com')
      );
      mockSignIn.mockResolvedValue({
        user: {
          id: 'merchant-user-id',
          email: 'merchant@example.com',
          isTest: false,
          createdAt: '2021-01-01',
          marketingEmailsOptIn: true,
        },
        token: 'jwt-token',
      });
      mockCreateAccount.mockResolvedValue({} as any);

      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        {
          body: {
            email: 'merchant@example.com',
            merchantName: 'Existing Merchant',
            marketingEmailsOptIn: true,
            merchantId: 'merchant-123',
          },
          query: {},
        },
        { responseHeaders } as any
      );

      expect(mockSignIn).toHaveBeenCalledWith(
        { email: 'merchant@example.com' },
        mockDeps
      );
      expect(mockRepository.getAccountsByUserId).toHaveBeenCalledWith(
        'merchant-user-id'
      );
      expect(mockCreateAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'merchant-user-id',
          accountType: 'CREDIT_LINE',
          creditLimitMinor: 500_000,
        }),
        expect.anything()
      );
      expect(result.status).toBe(201);
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 400 for UserValidationError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignUp.mockRejectedValue(
        new UserValidationError('', 'Invalid email format')
      );
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler(
          {
            body: {
              email: '',
              marketingEmailsOptIn: true,
            },
            query: {},
          },
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
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
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
          {
            body: {
              email: '',
              marketingEmailsOptIn: true,
            },
            query: {},
          },
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
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      const error = new Error('Database connection failed');
      mockSignUp.mockRejectedValue(error);
      const responseHeaders = createMockHeaders();
      await expect(
        signUpHandler(
          {
            body: {
              email: 'testuser@example.com',
              marketingEmailsOptIn: true,
            },
            query: {},
          },
          {
            responseHeaders,
          } as any
        )
      ).rejects.toThrow('Database connection failed');
    });

    it('should return 400 when merchantId is provided without merchantName', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
        merchantDirectoryRepository: mockMerchantDirectoryRepository,
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);

      const responseHeaders = createMockHeaders();
      const result = await signUpHandler(
        {
          body: {
            email: 'merchant@example.com',
            marketingEmailsOptIn: true,
            merchantId: 'merchant-123',
          },
          query: {},
        },
        { responseHeaders } as any
      );

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        error: 'VALIDATION_ERROR',
        message: 'Merchant name is required when signing up as a merchant',
      });
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
          merchantId: 'merchant-789',
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
        merchantId: 'merchant-789',
      });
      expect(responseHeaders.get('Set-Cookie')).toContain('demoAuth=jwt-token');
    });

    it('should return 401 for UserNotFoundError', async () => {
      const mockDeps = {
        logger: mockLogger,
        config: { jwtTtlSeconds: 604800, testUserTtlSeconds: 600 },
      };
      mockGetDependencies.mockResolvedValueOnce(mockDeps as any);
      mockSignIn.mockRejectedValue(
        new UserNotFoundError('missinguser@example.com')
      );
      const responseHeaders = createMockHeaders();
      const result = await signInHandler(
        { body: { email: 'missinguser@example.com' } },
        { responseHeaders } as any
      );
      expect(result.status).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message:
          'User not found. Please check the email and try again or sign up.',
      });
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
