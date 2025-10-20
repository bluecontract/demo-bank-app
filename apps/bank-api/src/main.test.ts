import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handler } from './main';
import type {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
  Context,
  Callback,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';

// Mock the auth handlers module
vi.mock('./auth/handlers', () => ({
  signUpHandler: vi.fn(),
  signInHandler: vi.fn(),
}));

// Mock the auth/errors module
vi.mock('./auth/errors', () => ({
  toUserAlreadyExistsError: vi.fn(),
}));

// Mock the errors module
vi.mock('./errors', () => ({
  toValidationError: vi.fn(),
  toInternalServerError: vi.fn(),
  createErrorHandler: vi.fn(() => vi.fn()),
}));

// Mock the shared modules
vi.mock('./shared/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('./shared/metrics', () => ({
  getMetrics: vi.fn(() => ({
    publishStoredMetrics: vi.fn(),
  })),
}));

vi.mock('./shared/security', () => ({
  getSecurityHeaders: vi.fn(() => ({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'x-xss-protection': '0',
    'content-security-policy': "default-src 'self'",
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  })),
}));

const createTestEvent = (
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: path,
  rawQueryString: '',
  headers: {
    'Content-Type': 'application/json',
    ...headers,
  },
  requestContext: {
    accountId: '123456789012',
    apiId: 'test-api',
    domainName: 'localhost',
    domainPrefix: 'test',
    http: {
      method: method,
      path: path,
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test-user-agent',
    },
    requestId: 'test-request-id',
    routeKey: '$default',
    stage: 'test',
    time: '01/Jan/2024:12:00:00 +0000',
    timeEpoch: 1704110400000,
  } as APIGatewayEventRequestContextV2,
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false,
});

describe('Bank Lambda Business Logic', () => {
  describe('Bank Lambda Setup', () => {
    it('should have a valid API contract', () => {
      expect(bankApiContract).toBeDefined();
      expect(bankApiContract.health).toBeDefined();
      expect(bankApiContract.signUp).toBeDefined();
      expect(bankApiContract.signIn).toBeDefined();
    });

    it('should have health endpoint defined', () => {
      expect(bankApiContract.health.method).toBe('GET');
      expect(bankApiContract.health.path).toBe('/health');
    });

    it('should have sign-up endpoint defined', () => {
      expect(bankApiContract.signUp.method).toBe('POST');
      expect(bankApiContract.signUp.path).toBe('/auth/signup');
    });

    it('should have sign-in endpoint defined', () => {
      expect(bankApiContract.signIn.method).toBe('POST');
      expect(bankApiContract.signIn.path).toBe('/auth/signin');
    });
  });
});

describe('Bank API Handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    // Mock environment variables
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_DYNAMO_TABLE_NAME', 'test-table');
    vi.stubEnv('BANKING_DYNAMO_TABLE_NAME', 'test-table');
    vi.stubEnv(
      'JWT_SECRET_ARN',
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:jwt-secret-abc123'
    );
    vi.stubEnv('JWT_TTL_SECONDS', '3600');
    vi.stubEnv('TEST_USER_TTL_SECONDS', '600');
    vi.stubEnv('SERVICE_NAME', 'test-service');
    vi.stubEnv('LOG_LEVEL', 'INFO');
    vi.stubEnv('METRICS_NAMESPACE', 'Test');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    // Mock the Secrets Manager response for JWT secret
    const mockSecretsManagerClient = {
      send: vi.fn().mockResolvedValue({
        SecretString: JSON.stringify({ secret: 'test-jwt-secret' }),
      }),
    };

    vi.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: vi.fn(() => mockSecretsManagerClient),
      GetSecretValueCommand: vi.fn(),
    }));

    // Reset mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Handler Configuration', () => {
    it('should have a valid handler function', () => {
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status with environment variables when set', async () => {
      vi.stubEnv('npm_package_version', '2.1.0');
      vi.stubEnv('NODE_ENV', 'production');

      const event = createTestEvent('GET', '/health');

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        status: 'healthy',
        timestamp: '2024-01-01T12:00:00.000Z',
        version: '2.1.0',
        environment: 'production',
      });
    });

    it('should include CORS headers in health response', async () => {
      const event = createTestEvent('GET', '/health', null, {
        Origin: 'https://example.com',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://example.com',
      });
    });
  });

  describe('CORS Configuration', () => {
    it('should handle OPTIONS preflight request for signin endpoint', async () => {
      const event = createTestEvent('OPTIONS', '/auth/signin', null, {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(204);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers':
          'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,idempotency-key',
        vary: 'Origin',
      });
    });

    it('should handle OPTIONS preflight request', async () => {
      const event = createTestEvent('OPTIONS', '/auth/signup', null, {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(204);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers':
          'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,idempotency-key',
        vary: 'Origin',
      });
    });

    it('should set correct CORS headers for different origins', async () => {
      const origins = ['https://localhost:3000', 'https://app.example.com'];

      for (const origin of origins) {
        const event = createTestEvent('GET', '/health', null, {
          Origin: origin,
        });

        const result = (await handler(
          event,
          {} as Context,
          vi.fn() as Callback
        )) as APIGatewayProxyResult;

        expect(result.headers).toMatchObject({
          'access-control-allow-origin': origin,
          vary: 'Origin',
        });
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle requests without Origin header', async () => {
      const event = createTestEvent('GET', '/health');

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(result.headers?.['access-control-allow-origin']).toBeUndefined();
    });

    it('should handle malformed JSON in request body gracefully', async () => {
      const event = createTestEvent('POST', '/auth/signup');
      event.body = '{"malformed": json}';

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      // Should be handled by ts-rest validation
      expect(result.statusCode).toBe(500);
    });

    it('should handle empty request body', async () => {
      const event = createTestEvent('POST', '/auth/signup');
      event.body = '';

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback
      )) as APIGatewayProxyResult;

      // Should be handled by ts-rest validation
      expect(result.statusCode).toBe(500);
    });
  });
});
