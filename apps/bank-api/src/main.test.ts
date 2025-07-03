import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import { handler } from './main';
import { UserAlreadyExistsError, InvalidUserNameError } from '@demo-blue/auth';
import { signUpHandler } from './auth';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayEventRequestContext,
  Context,
  Callback,
} from 'aws-lambda';

// Mock the signUpHandler to control its behavior in tests
vi.mock('./auth', () => ({
  signUpHandler: vi.fn(),
}));

const mockSignUpHandler = vi.mocked(signUpHandler);

// Mock AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  },
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  TransactWriteCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({})),
  GetParameterCommand: vi.fn(),
}));

// Mock AWS Lambda Powertools
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendPersistentKeys: vi.fn(),
  })),
}));

vi.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: vi.fn(() => ({
    addMetric: vi.fn(),
    publishStoredMetrics: vi.fn(),
  })),
}));

const createTestEvent = (
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): APIGatewayProxyEvent => ({
  httpMethod: method,
  path,
  pathParameters: null,
  queryStringParameters: null,
  headers: {
    'Content-Type': 'application/json',
    ...headers,
  },
  body: body ? JSON.stringify(body) : null,
  isBase64Encoded: false,
  multiValueHeaders: {},
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {
    accountId: '123456789012',
    apiId: 'test-api',
    httpMethod: method,
    path,
    stage: 'test',
    requestId: 'test-request-id',
    resourceId: 'test-resource',
    resourcePath: path,
    identity: {
      sourceIp: '127.0.0.1',
      userAgent: 'test-agent',
    },
  } as APIGatewayEventRequestContext,
  resource: path,
});

describe('Bank Lambda Business Logic', () => {
  describe('Bank Lambda Setup', () => {
    it('should have a valid API contract', () => {
      expect(bankApiContract).toBeDefined();
      expect(bankApiContract.health).toBeDefined();
      expect(bankApiContract.signUp).toBeDefined();
    });

    it('should have health endpoint defined', () => {
      expect(bankApiContract.health.method).toBe('GET');
      expect(bankApiContract.health.path).toBe('/health');
    });

    it('should have sign-up endpoint defined', () => {
      expect(bankApiContract.signUp.method).toBe('POST');
      expect(bankApiContract.signUp.path).toBe('/auth/signup');
    });
  });
});

describe('Bank API Handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    // Mock environment variables
    vi.stubEnv('DYNAMO_TABLE_NAME', 'test-table');
    vi.stubEnv('JWT_SECRET_PARAMETER_NAME', '/test/jwt-secret');
    vi.stubEnv('JWT_TTL_SECONDS', '3600');
    vi.stubEnv('TEST_USER_TTL_SECONDS', '600');
    vi.stubEnv('SERVICE_NAME', 'test-service');
    vi.stubEnv('LOG_LEVEL', 'INFO');
    vi.stubEnv('METRICS_NAMESPACE', 'Test');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    // Mock the SSM parameter response for JWT secret
    const mockSsmClient = {
      send: vi.fn().mockResolvedValue({
        Parameter: { Value: 'test-jwt-secret' },
      }),
    };

    vi.doMock('@aws-sdk/client-ssm', () => ({
      SSMClient: vi.fn(() => mockSsmClient),
      GetParameterCommand: vi.fn(),
    }));

    // Reset mock before each test
    mockSignUpHandler.mockReset();
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

    it('should handle health endpoint', async () => {
      // Given
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/health',
        pathParameters: null,
        queryStringParameters: null,
        headers: {},
        body: null,
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayEventRequestContext,
        resource: '',
      };

      // When
      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        status: 'healthy',
        timestamp: '2024-01-01T12:00:00.000Z',
        version: '0.0.0',
        environment: 'test',
      });
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status with default environment values', async () => {
      const event = createTestEvent('GET', '/health');

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        status: 'healthy',
        timestamp: '2024-01-01T12:00:00.000Z',
        version: '0.0.0',
        environment: 'test',
      });
    });

    it('should return health status with environment variables when set', async () => {
      vi.stubEnv('npm_package_version', '2.1.0');
      vi.stubEnv('NODE_ENV', 'production');

      const event = createTestEvent('GET', '/health');

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
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
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://example.com',
      });
    });
  });

  describe('Sign-up Endpoint', () => {
    it('should delegate to signUpHandler for successful sign-up', async () => {
      const mockResponse = {
        status: 201,
        body: { userId: 'test-user-id', name: 'testuser' },
      };
      mockSignUpHandler.mockResolvedValue(mockResponse);

      const event = createTestEvent('POST', '/auth/signup', {
        name: 'testuser',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);
      expect(mockSignUpHandler).toHaveBeenCalledOnce();
      const body = JSON.parse(result.body);
      expect(body).toEqual({ userId: 'test-user-id', name: 'testuser' });
    });

    it('should include CORS headers in sign-up response', async () => {
      const mockResponse = {
        status: 201,
        body: { userId: 'test-user-id', name: 'testuser' },
      };
      mockSignUpHandler.mockResolvedValue(mockResponse);

      const event = createTestEvent(
        'POST',
        '/auth/signup',
        { name: 'testuser' },
        {
          Origin: 'https://app.example.com',
        }
      );

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle UserAlreadyExistsError with 409 status', async () => {
      const error = new UserAlreadyExistsError('existinguser');
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent('POST', '/auth/signup', {
        name: 'existinguser',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this name already exists. Please choose a different name.',
      });
    });

    it('should handle InvalidUserNameError with 400 status', async () => {
      const error = new InvalidUserNameError('', 'Invalid username format');
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent('POST', '/auth/signup', { name: '' });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Request validation failed');
      expect(body.errors).toBeDefined();
      expect(body.errors.bodyError).toContain(
        'String must contain at least 1 character'
      );
    });

    it('should handle RequestValidationError with detailed error information', async () => {
      const error = {
        name: 'RequestValidationError',
        message: 'Request validation failed',
        pathParamsError: '{}',
        queryParamsError: '{}',
        bodyError: '{"name": "Required"}',
        headerError: '{}',
      };
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent('POST', '/auth/signup', {});

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Request validation failed');
      expect(body.errors).toBeDefined();
      expect(body.errors.bodyError).toContain('Required');
      expect(body.errors.pathParamsError).toBe('null');
    });

    it('should handle unknown errors with 500 status', async () => {
      const error = new Error('Database connection failed');
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent('POST', '/auth/signup', {
        name: 'testuser',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        message: 'INTERNAL_ERROR',
      });
    });

    it('should handle non-Error objects thrown as errors', async () => {
      const error = { someProperty: 'unexpected error format' };
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent('POST', '/auth/signup', {
        name: 'testuser',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        message: 'INTERNAL_ERROR',
      });
    });

    it('should include CORS headers in error responses', async () => {
      const error = new UserAlreadyExistsError('existinguser');
      mockSignUpHandler.mockRejectedValue(error);

      const event = createTestEvent(
        'POST',
        '/auth/signup',
        { name: 'existinguser' },
        {
          Origin: 'https://app.example.com',
        }
      );

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(409);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
      });
    });
  });

  describe('CORS Configuration', () => {
    it('should handle OPTIONS preflight request', async () => {
      const event = createTestEvent('OPTIONS', '/auth/signup', null, {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      });

      const result = (await handler(
        event,
        {} as Context,
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(204);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers':
          'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
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
          vi.fn() as Callback<APIGatewayProxyResult>
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
        vi.fn() as Callback<APIGatewayProxyResult>
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
        vi.fn() as Callback<APIGatewayProxyResult>
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
        vi.fn() as Callback<APIGatewayProxyResult>
      )) as APIGatewayProxyResult;

      // Should be handled by ts-rest validation
      expect(result.statusCode).toBe(500);
    });
  });
});
