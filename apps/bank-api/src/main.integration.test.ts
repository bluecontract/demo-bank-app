import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handler } from './main';
import type {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
  Context,
  Callback,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  ResourceExistsException,
} from '@aws-sdk/client-secrets-manager';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken';
import {
  assertAllSecurityHeaders,
  DEFAULT_TEST_ORIGIN,
} from './test-helpers/security-assertions';

/**
 * Integration Tests - Test against LocalStack AWS services
 * These tests require LocalStack to be running
 */

// Test configuration
const TEST_CONFIG = {
  tableName: `demo-blue-bank-api-integration-test-${Date.now()}`,
  jwtSecretArn: '/demo-blue/integration-test/jwt-secret',
  jwtSecret: 'integration-test-jwt-secret-key-12345',
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  jwtTtlSeconds: 3600,
  testUserTtlSeconds: 600,
};

// AWS clients configured for LocalStack
let dynamoClient: DynamoDBClient;
let secretsManagerClient: SecretsManagerClient;

describe('Bank API Integration Tests', () => {
  beforeAll(async () => {
    dynamoClient = new DynamoDBClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    secretsManagerClient = new SecretsManagerClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    // Set up environment variables for integration testing
    process.env.AUTH_DYNAMO_TABLE_NAME = TEST_CONFIG.tableName;
    process.env.BANKING_DYNAMO_TABLE_NAME = TEST_CONFIG.tableName;
    process.env.JWT_SECRET_ARN = TEST_CONFIG.jwtSecretArn;
    process.env.JWT_TTL_SECONDS = TEST_CONFIG.jwtTtlSeconds.toString();
    process.env.TEST_USER_TTL_SECONDS =
      TEST_CONFIG.testUserTtlSeconds.toString();
    process.env.SERVICE_NAME = 'bank-api-integration-test';
    process.env.LOG_LEVEL = 'INFO';
    process.env.METRICS_NAMESPACE = 'IntegrationTest';
    process.env.AWS_REGION = TEST_CONFIG.region;
    process.env.AWS_ENDPOINT_URL = TEST_CONFIG.localstackEndpoint;

    // Set LocalStack credentials for AWS SDK
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';

    await setupLocalStackResources();
  });

  afterAll(async () => {
    await cleanupLocalStackResources();

    delete process.env.AUTH_DYNAMO_TABLE_NAME;
    delete process.env.BANKING_DYNAMO_TABLE_NAME;
    delete process.env.JWT_SECRET_ARN;
    delete process.env.JWT_TTL_SECONDS;
    delete process.env.TEST_USER_TTL_SECONDS;
    delete process.env.SERVICE_NAME;
    delete process.env.LOG_LEVEL;
    delete process.env.METRICS_NAMESPACE;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  describe('Preflight Requests', () => {
    it('should return 204 for OPTIONS requests', async () => {
      const paths = [
        '/auth/signup',
        '/auth/signin',
        '/health',
        '/v1/accounts',
        '/v1/accounts/:accountId',
      ];
      for (const path of paths) {
        const result = await invokeApi({
          method: 'OPTIONS',
          path,
        });
        expect(result.statusCode).toBe(204);
        expect(result.headers).toMatchObject({
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers':
            'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,idempotency-key',
        });
      }
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status with correct format', async () => {
      // Given
      const health = await invokeApi({
        method: 'GET',
        path: '/health',
      });

      // Then
      expect(health.statusCode).toBe(200);
      expect(health.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String),
        environment: expect.any(String),
      });
    });
  });

  describe('Sign-up Endpoint', () => {
    it('should successfully sign up a new user with valid JWT cookie', async () => {
      const creds = await signupUniqueTestUser('integration-test-user');
      expect(creds.userId).toBeDefined();
      expect(creds.userName).toContain('integration-test-user');
      expect(creds.jwtCookie).toContain('demoAuth=');
    });

    it('should return 409 when signing up with existing username', async () => {
      const creds = await signupUniqueTestUser('duplicate-test');
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup',
        body: { name: creds.userName },
      });
      expect(signUp.statusCode).toBe(409);
      expect(signUp.body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this name already exists. Please choose a different name.',
      });
    });

    it('should return 400 for invalid request data', async () => {
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup',
        body: { name: '' },
      });
      expect(signUp.statusCode).toBe(400);
      expect(signUp.body).toEqual({
        error: 'VALIDATION_ERROR',
        errors: expect.any(String),
        message: 'Request validation failed',
      });
      expect(JSON.parse(signUp.body.errors)).toMatchObject({
        bodyErrors: [
          {
            exact: false,
            inclusive: true,
            message: 'String must contain at least 1 character(s)',
            minimum: 1,
            path: ['name'],
            type: 'string',
          },
        ],
      });
    });

    it('should create test user with shorter TTL when dev=true', async () => {
      const name = await generateUniqueTestUserName('dev-test-user');
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup?dev=true',
        body: { name },
      });
      expect(signUp.statusCode).toBe(201);
      const cookieHeader = signUp.headers?.['set-cookie'] as string;
      expect(cookieHeader).toContain(
        `Max-Age=${TEST_CONFIG.testUserTtlSeconds}`
      );
    });

    it('should handle complex XSS payloads in account creation', async () => {
      // Given - complex XSS payload in account name
      const name = await generateUniqueTestUserName('xss-test-user');
      const maliciousAccountName = `<img src="x" onerror="alert('XSS')"><script>document.cookie='stolen'</script>${name}`;

      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup',
        body: { name: maliciousAccountName },
      });

      if (signUp.statusCode === 201) {
        // Verify XSS payloads are removed but safe content remains
        expect(signUp.body.name).toBe(name);
        expect(signUp.body.name).not.toContain('<img');
        expect(signUp.body.name).not.toContain('<script>');
        expect(signUp.body.name).not.toContain('onerror');
        expect(signUp.body.name).not.toContain('alert');
      }
    });
  });

  describe('Sign-in Endpoint', () => {
    it('should successfully sign in an existing user with valid JWT cookie', async () => {
      const creds = await signupUniqueTestUser('signin-test-user');
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { name: creds.userName },
      });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.body).toEqual({
        userId: creds.userId,
        name: creds.userName,
      });
      const cookieHeader = signIn.headers?.['set-cookie'] as string | undefined;
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('demoAuth=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=None');
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain(`Max-Age=${TEST_CONFIG.jwtTtlSeconds}`);
      if (!cookieHeader) {
        throw new Error('Cookie header is undefined');
      }
      const token = extractTokenFromCookie(cookieHeader);
      const decoded = jwt.verify(token, TEST_CONFIG.jwtSecret) as any;
      expect(decoded.sub).toBe(signIn.body.userId);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should return 401 when signing in with non-existing username', async () => {
      const nonExistentUserName =
        generateUniqueTestUserName('nonexistent-user');
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { name: nonExistentUserName },
      });
      expect(signIn.statusCode).toBe(401);
      expect(signIn.body).toEqual({
        error: 'UNAUTHORIZED',
        message:
          'User not found. Please check the name and try again or sign up.',
      });
    });

    it('should return 400 for invalid sign-in request data', async () => {
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { name: '' },
      });
      expect(signIn.statusCode).toBe(400);
      const body = signIn.body;
      expect(body).toEqual({
        error: 'VALIDATION_ERROR',
        errors: expect.any(String),
        message: 'Request validation failed',
      });
      expect(JSON.parse(body.errors)).toMatchObject({
        bodyErrors: [
          {
            exact: false,
            inclusive: true,
            message: 'String must contain at least 1 character(s)',
            minimum: 1,
            path: ['name'],
            type: 'string',
          },
        ],
        pathParameterErrors: null,
        queryParameterErrors: null,
        headerErrors: null,
      });
    });

    it('should work with test users created via dev=true', async () => {
      const creds = await signupUniqueTestUser('test-signin-user', true);
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin?dev=true',
        body: { name: creds.userName },
        queryStringParameters: { dev: 'true' },
      });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.body.userId).toBe(creds.userId);
      expect(signIn.body.name).toBe(creds.userName);
      const cookieHeader = signIn.headers?.['set-cookie'] as string;
      expect(cookieHeader).toContain(`Max-Age=600`);
    });
  });

  describe('Create Account Endpoint', () => {
    let jwtCookie: string;

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('account-user');
      jwtCookie = creds.jwtCookie;
    });

    it('should create a new account for authenticated user', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Test Account' },
      });
      expect(result.statusCode).toBe(201);
      expect(result.body).toMatchObject({
        accountId: expect.any(String),
        accountNumber: expect.any(String),
        currency: 'USD',
        createdAt: expect.any(String),
        ledgerBalanceMinor: 0,
        availableBalanceMinor: 0,
        status: 'ACTIVE',
      });
    });

    it('should return 401 if not authenticated', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        body: { name: 'Test Account' },
      });
      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });

    it('should handle complex XSS payloads in account creation', async () => {
      const name = 'Pure Account Name';
      const maliciousAccountName = `<img src="x" onerror="alert('XSS')"><script>document.cookie='stolen'</script>${name}`;

      const result = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: maliciousAccountName },
      });

      expect(result.body.name).toBe(name);
      expect(result.body.name).not.toContain('<img');
      expect(result.body.name).not.toContain('<script>');
      expect(result.body.name).not.toContain('onerror');
      expect(result.body.name).not.toContain('alert');
    });
  });

  describe('List Accounts Endpoint', () => {
    let jwtCookie: string;

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('list-accounts-user');
      jwtCookie = creds.jwtCookie;
    });

    it('should return an empty array if user has no accounts', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: '/v1/accounts',
        jwtCookie,
      });
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ accounts: [] });
    });

    it('should return a list of accounts for authenticated user', async () => {
      for (let i = 0; i < 2; i++) {
        const create = await invokeApi({
          method: 'POST',
          path: '/v1/accounts',
          jwtCookie,
          body: { name: 'Test Account' },
        });
        expect(create.statusCode).toBe(201);
      }
      const result = await invokeApi({
        method: 'GET',
        path: '/v1/accounts',
        jwtCookie,
      });
      expect(result.statusCode).toBe(200);
      expect(Array.isArray(result.body.accounts)).toBe(true);
      expect(result.body.accounts.length).toBeGreaterThanOrEqual(2);
      for (const acc of result.body.accounts) {
        expect(acc).toMatchObject({
          accountId: expect.any(String),
          accountNumber: expect.any(String),
          currency: 'USD',
          createdAt: expect.any(String),
          status: 'ACTIVE',
        });
      }
    });

    it('should return 401 if user is not authenticated', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: '/v1/accounts',
      });
      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });
  });

  describe('Get Account Endpoint', () => {
    let jwtCookie: string;
    let accountId: string;

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('get-account-user');
      jwtCookie = creds.jwtCookie;
      // Create an account for the user
      const create = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Test Account' },
      });
      expect(create.statusCode).toBe(201);
      accountId = create.body.accountId;
    });

    it('should return the account for authenticated user', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}`,
        jwtCookie,
      });
      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({
        accountId,
        accountNumber: expect.any(String),
        currency: 'USD',
        createdAt: expect.any(String),
        ledgerBalanceMinor: 0,
        availableBalanceMinor: 0,
        status: 'ACTIVE',
      });
    });

    it('should return 404 if account does not exist', async () => {
      const nonExistentAccountId = crypto.randomUUID();
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${nonExistentAccountId}`,
        jwtCookie,
      });
      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found',
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}`,
      });
      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });
  });
});

// Helper functions

function generateUniqueTestUserName(prefix = 'test-user'): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

function createTestEvent(
  method: string,
  path: string,
  body?: object
): APIGatewayProxyEventV2 {
  const requestBody =
    method === 'GET' || method === 'DELETE' ? null : body || {};

  const urlParams = new URLSearchParams(path.split('?')[1]);
  const queryStringParameters = path.includes('?')
    ? {
        queryStringParameters: Object.fromEntries(
          new URLSearchParams(path.split('?')[1])
        ),
        rawQueryString: urlParams.toString(),
      }
    : { rawQueryString: '' };

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    requestContext: {
      requestId: 'test-request-id',
      stage: 'test',
      httpMethod: method,
      path: path,
      accountId: '123456789012',
      resourceId: 'test-resource',
      apiId: 'test-api',
      http: {
        method: method,
        path: path,
        protocol: 'http',
        sourceIp: '127.0.0.1',
        userAgent: 'test-user-agent',
      },
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      identity: {
        accessKey: 'test',
        accountId: '123456789012',
        apiKey: 'test',
      },
      domainName: 'localhost',
      domainPrefix: 'test',
      routeKey: '$default',
    } as APIGatewayEventRequestContextV2,
    headers: {
      'Content-Type': 'application/json',
    },
    ...queryStringParameters,
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    isBase64Encoded: false,
  };
}

function extractTokenFromCookie(cookieHeader: string): string {
  const match = cookieHeader.match(/demoAuth=([^;]+)/);
  if (!match) {
    throw new Error('No auth token found in cookie header');
  }
  return match[1];
}

async function setupLocalStackResources(): Promise<void> {
  try {
    // Create DynamoDB table
    await dynamoClient.send(
      new CreateTableCommand({
        TableName: TEST_CONFIG.tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'AUTH_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'AUTH_GSI1SK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI1SK', AttributeType: 'S' },

          { AttributeName: 'BANKING_GSI2PK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI2SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'AUTH_GSI1',
            KeySchema: [
              { AttributeName: 'AUTH_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'AUTH_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'BANKING_GSI1',
            KeySchema: [
              { AttributeName: 'BANKING_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'BANKING_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },

          {
            IndexName: 'BANKING_GSI2',
            KeySchema: [
              { AttributeName: 'BANKING_GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'BANKING_GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );

    // Wait for table to be active
    let tableReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const result = await dynamoClient.send(
          new DescribeTableCommand({ TableName: TEST_CONFIG.tableName })
        );
        if (result.Table?.TableStatus === 'ACTIVE') {
          tableReady = true;
          break;
        }
      } catch {
        // Table might not exist yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!tableReady) {
      throw new Error('DynamoDB table failed to become active');
    }

    // Create Secrets Manager secret
    try {
      await secretsManagerClient.send(
        new CreateSecretCommand({
          Name: TEST_CONFIG.jwtSecretArn,
          SecretString: JSON.stringify({ secret: TEST_CONFIG.jwtSecret }),
          Description: 'JWT secret for integration tests',
        })
      );
    } catch (error) {
      if (error instanceof ResourceExistsException) {
        console.info('Secrets Manager secret already exists:', error);
      }
    }
  } catch (error) {
    console.error('Failed to setup LocalStack resources:', error);
    throw error;
  }
}

async function cleanupLocalStackResources(): Promise<void> {
  const cleanupPromises: Promise<void>[] = [];

  // Delete DynamoDB table
  cleanupPromises.push(
    dynamoClient
      .send(new DeleteTableCommand({ TableName: TEST_CONFIG.tableName }))
      .then(() => void 0)
      .catch(error => {
        console.warn('Failed to cleanup DynamoDB table:', error);
      })
  );

  cleanupPromises.push(
    secretsManagerClient
      .send(
        new DeleteSecretCommand({
          SecretId: TEST_CONFIG.jwtSecretArn,
          ForceDeleteWithoutRecovery: true,
        })
      )
      .then(() => void 0)
      .catch(error => {
        console.warn('Failed to cleanup Secrets Manager secret:', error);
      })
  );

  await Promise.all(cleanupPromises);
}

// DRY helper for invoking the API handler
async function invokeApi({
  method,
  path,
  body,
  jwtCookie,
  headers = { origin: DEFAULT_TEST_ORIGIN },
}: {
  method: string;
  path: string;
  body?: object;
  queryStringParameters?: Record<string, string>;
  jwtCookie?: string;
  headers?: Record<string, string>;
}) {
  const event = createTestEvent(method, path, body);
  if (jwtCookie) event.headers['cookie'] = jwtCookie;
  Object.assign(event.headers, headers);
  console.log('Invoking API', {
    method,
    path,
    body,
    jwtCookie,
    headers,
  });
  const result = (await handler(event, {} as Context, {} as Callback)) as {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    cookies: string[];
  };
  const responseBody = result.body ? JSON.parse(result.body) : result.body;
  assertAllSecurityHeaders(result, headers.origin);
  return {
    ...result,
    body: responseBody,
  };
}

// DRY helper for signing up a unique test user and extracting credentials
async function signupUniqueTestUser(
  namePrefix = 'test-user',
  isTest = false
): Promise<{ userId: string; jwtCookie: string; userName: string }> {
  const userName = generateUniqueTestUserName(namePrefix);
  const signUp = await invokeApi({
    method: 'POST',
    path: isTest ? '/auth/signup?dev=true' : '/auth/signup',
    body: { name: userName },
  });
  expect(signUp.statusCode).toBe(201);
  if (!signUp.headers || typeof signUp.headers['set-cookie'] !== 'string') {
    throw new Error('Missing set-cookie header in signUp response');
  }
  return {
    userId: signUp.body.userId,
    jwtCookie: signUp.headers['set-cookie'],
    userName,
  };
}
