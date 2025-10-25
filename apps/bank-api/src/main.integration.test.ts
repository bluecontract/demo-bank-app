import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handler } from './main';
import type {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
  Context,
  Callback,
} from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
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
import { DynamoHoldRepository } from '@demo-bank-app/banking';
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
  tableName: `demo-bank-app-bank-api-integration-test-${Date.now()}`,
  jwtSecretArn: '/demo-bank-app/integration-test/jwt-secret',
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
      expect(creds.userEmail).toContain('integration-test-user');
      expect(creds.jwtCookie).toContain('demoAuth=');
    });

    it('should return 409 when signing up with existing email', async () => {
      const creds = await signupUniqueTestUser('duplicate-test');
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup',
        body: { email: creds.userEmail },
      });
      expect(signUp.statusCode).toBe(409);
      expect(signUp.body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this email already exists. Please use a different email.',
      });
    });

    it('should return 400 for invalid request data', async () => {
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup',
        body: { email: '' },
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
            message: 'Invalid email',
            path: ['email'],
          },
        ],
      });
    });

    it('should create test user with shorter TTL when dev=true', async () => {
      const email = await generateUniqueTestUserName('dev-test-user');
      const signUp = await invokeApi({
        method: 'POST',
        path: '/auth/signup?dev=true',
        body: { email },
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
        body: { email: maliciousAccountName },
      });

      expect(signUp.statusCode).toBe(400);
      expect(signUp.body.error).toBe('VALIDATION_ERROR');
      expect(signUp.body.message).toBe('Request validation failed');
    });
  });

  describe('Sign-in Endpoint', () => {
    it('should successfully sign in an existing user with valid JWT cookie', async () => {
      const creds = await signupUniqueTestUser('signin-test-user');
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { email: creds.userEmail },
      });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.body).toEqual({
        userId: creds.userId,
        email: creds.userEmail,
      });
      const cookieHeader = signIn.headers?.['set-cookie'] as string | undefined;
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('demoAuth=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=Strict');
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

    it('should return 401 when signing in with non-existing email', async () => {
      const nonExistentUserEmail =
        generateUniqueTestUserName('nonexistent-user');
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { email: nonExistentUserEmail },
      });
      expect(signIn.statusCode).toBe(401);
      expect(signIn.body).toEqual({
        error: 'UNAUTHORIZED',
        message:
          'User not found. Please check the email and try again or sign up.',
      });
    });

    it('should return 400 for invalid sign-in request data', async () => {
      const signIn = await invokeApi({
        method: 'POST',
        path: '/auth/signin',
        body: { email: '' },
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
            message: 'Invalid email',
            path: ['email'],
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
        body: { email: creds.userEmail },
        queryStringParameters: { dev: 'true' },
      });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.body.userId).toBe(creds.userId);
      expect(signIn.body.email).toBe(creds.userEmail);
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

  describe('Fund Account Endpoint', () => {
    let jwtCookie: string;
    let accountId: string;

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('fund-account-user');
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

    it('should fund the account and return 201 with txnId', async () => {
      const idempotencyKey = crypto.randomUUID();
      const fund = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': idempotencyKey,
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 500 },
      });
      expect(fund.statusCode).toBe(201);
      expect(fund.body).toHaveProperty('txnId');
      // Check balance increased
      const get = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}`,
        jwtCookie,
      });
      expect(get.statusCode).toBe(200);
      expect(get.body.ledgerBalanceMinor).toBe(500);
      expect(get.body.availableBalanceMinor).toBe(500);
    });

    it('should return 401 if user is not authenticated', async () => {
      const fund = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 100 },
      });
      expect(fund.statusCode).toBe(401);
      expect(fund.body).toMatchObject({
        message: 'Unauthorized',
      });
    });

    it('should return 400 if idempotency-key is missing', async () => {
      const fund = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        body: { amountMinor: 100 },
      });
      expect(fund.statusCode).toBe(400);
      const body = fund.body;
      expect(body).toMatchObject({
        error: 'VALIDATION_ERROR',
        errors: expect.any(String),
        message: expect.any(String),
      });
      expect(JSON.parse(body.errors)).toMatchObject({
        bodyErrors: null,
        pathParameterErrors: null,
        queryParameterErrors: null,
        headerErrors: [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['idempotency-key'],
            message: 'Required',
          },
        ],
      });
    });

    it('should return 404 if account does not exist', async () => {
      const nonExistentAccountId = crypto.randomUUID();
      const fund = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${nonExistentAccountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 100 },
      });
      expect(fund.statusCode).toBe(404);
      expect(fund.body).toMatchObject({
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found',
      });
    });

    it('should return 400 if amountMinor is invalid', async () => {
      const fund = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: -100 },
      });
      expect(fund.statusCode).toBe(400);
      expect(fund.body.error).toMatch(/VALIDATION|amount/i);
    });

    it('should be idempotent for same idempotency-key', async () => {
      const create = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Test Account' },
      });
      expect(create.statusCode).toBe(201);
      expect(create.body.accountId).toBeDefined();

      const idempotencyKey = crypto.randomUUID();
      const fund1 = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${create.body.accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': idempotencyKey,
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 200 },
      });
      expect(fund1.statusCode).toBe(201);
      expect(fund1.body).toHaveProperty('txnId');
      const fund2 = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${create.body.accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': idempotencyKey,
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 200 },
      });
      expect(fund2.statusCode).toBe(201);
      expect(fund2.body).toHaveProperty('txnId');
      expect(fund2.body.txnId).toBe(fund1.body.txnId);
      // Balance should not double-fund
      const get = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${create.body.accountId}`,
        jwtCookie,
      });
      expect(get.statusCode).toBe(200);
      expect(get.body.ledgerBalanceMinor).toBe(200);
    });
  });

  describe('Transfer Money Endpoint', () => {
    let user1: { userId: string; jwtCookie: string; userEmail: string };
    let user2: { userId: string; jwtCookie: string; userEmail: string };
    let user1Account: { accountId: string };
    let user2Account: { accountId: string; accountNumber: string };

    beforeAll(async () => {
      user1 = await signupUniqueTestUser('transfer-user-1');
      user2 = await signupUniqueTestUser('transfer-user-2');
      // Create accounts for both users
      const acc1 = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie: user1.jwtCookie,
        body: { name: 'Test Account 1' },
      });
      user1Account = acc1.body;
      const acc2 = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie: user2.jwtCookie,
        body: { name: 'Test Account 2' },
      });
      user2Account = acc2.body;
      // Fund user1's account for transfer
      await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${user1Account.accountId}/funding`,
        jwtCookie: user1.jwtCookie,
        body: { amountMinor: 200 },
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
      });
    });

    it('should transfer money between users and return 201 with txnId', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie: user1.jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: user2Account.accountNumber,
          amountMinor: 100,
        },
      });
      expect(result.statusCode).toBe(201);
      expect(result.body).toHaveProperty('txnId');
      // Check balances
      const get1 = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${user1Account.accountId}`,
        jwtCookie: user1.jwtCookie,
      });
      expect(get1.statusCode).toBe(200);
      expect(get1.body.ledgerBalanceMinor).toBe(100);
      expect(get1.body.availableBalanceMinor).toBe(100);
      const get2 = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${user2Account.accountId}`,
        jwtCookie: user2.jwtCookie,
      });
      expect(get2.statusCode).toBe(200);
      expect(get2.body.ledgerBalanceMinor).toBe(100);
      expect(get2.body.availableBalanceMinor).toBe(100);
    });

    it('should return 401 if not authenticated', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: user2Account.accountNumber,
          amountMinor: 100,
        },
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
      });
      expect(result.statusCode).toBe(401);
      expect(result.body).toMatchObject({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });

    it('should return 400 if idempotency-key is missing', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie: user1.jwtCookie,
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: user2Account.accountNumber,
          amountMinor: 100,
        },
      });
      expect(result.statusCode).toBe(400);
      const body = result.body;
      expect(body).toMatchObject({
        error: 'VALIDATION_ERROR',
        errors: expect.any(String),
        message: expect.any(String),
      });
      expect(JSON.parse(body.errors)).toMatchObject({
        bodyErrors: null,
        pathParameterErrors: null,
        queryParameterErrors: null,
        headerErrors: [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['idempotency-key'],
            message: 'Required',
          },
        ],
      });
    });

    it('should return 404 if destination account not found', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie: user1.jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: '1111111111',
          amountMinor: 100,
        },
      });
      expect(result.body).toMatchObject({
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found',
      });
      expect(result.statusCode).toBe(404);
    });

    it('should return 400 if insufficient funds', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie: user1.jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: user2Account.accountNumber,
          amountMinor: 9999999,
        },
      });
      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds',
      });
    });

    it('should return 403 if forbidden (not owner)', async () => {
      const result = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie: user2.jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: user1Account.accountId,
          destinationAccountNumber: user2Account.accountNumber,
          amountMinor: 100,
        },
      });
      expect(result.statusCode).toBe(403);
      expect(result.body).toMatchObject({
        error: 'FORBIDDEN',
        message: 'Forbidden access',
      });
    });
  });

  describe('List Transactions Endpoint', () => {
    let jwtCookie: string;
    let accountId: string;
    const txnIds: string[] = [];

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('list-transactions-user');
      jwtCookie = creds.jwtCookie;

      // Create an account
      const createAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Test Account' },
      });
      expect(createAccount.statusCode).toBe(201);
      accountId = createAccount.body.accountId;

      // Fund the account to create transactions
      const fundResult = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 1000 },
      });
      expect(fundResult.statusCode).toBe(201);
      txnIds.push(fundResult.body.txnId);

      // Create a second account for transfer
      const secondUser = await signupUniqueTestUser('list-transactions-user-2');
      const secondAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie: secondUser.jwtCookie,
        body: { name: 'Second Account' },
      });
      expect(secondAccount.statusCode).toBe(201);

      // Transfer money to create another transaction
      const transferResult = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: accountId,
          destinationAccountNumber: secondAccount.body.accountNumber,
          amountMinor: 200,
        },
      });
      expect(transferResult.statusCode).toBe(201);
      txnIds.push(transferResult.body.txnId);
    });

    it('should list transactions for authenticated user', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toHaveProperty('items');
      expect(Array.isArray(result.body.items)).toBe(true);
      expect(result.body.items.length).toBe(2);

      // Verify transaction structure
      for (const txn of result.body.items) {
        expect(txn).toMatchObject({
          txnId: expect.any(String),
          accountId: accountId,
          side: expect.stringMatching(/^(DEBIT|CREDIT)$/),
          amountMinor: expect.any(Number),
          type: expect.any(String),
          status: expect.any(String),
          timestamp: expect.any(String),
          counterpartyAccountNumber: expect.any(String),
        });
        expect(txn.description).toBeDefined();
      }

      // Verify we have our expected transactions
      const returnedTxnIds = result.body.items.map((t: any) => t.txnId);
      expect(returnedTxnIds).toEqual(expect.arrayContaining(txnIds));
    });

    it('should return empty list for account with no transactions', async () => {
      // Create a new account with no transactions
      const newAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Empty Account' },
      });
      expect(newAccount.statusCode).toBe(201);

      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${newAccount.body.accountId}/transactions`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({
        items: [],
        next: undefined,
      });
    });

    it('should support pagination with limit parameter', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions?limit=1`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.items).toHaveLength(1);
      expect(result.body.items[0]).toMatchObject({
        txnId: expect.any(String),
        accountId: accountId,
        side: expect.stringMatching(/^(DEBIT|CREDIT)$/),
        amountMinor: expect.any(Number),
        type: expect.any(String),
        status: expect.any(String),
        timestamp: expect.any(String),
        counterpartyAccountNumber: expect.any(String),
      });
    });

    it('should return 404 if account does not exist', async () => {
      const nonExistentAccountId = crypto.randomUUID();
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${nonExistentAccountId}/transactions`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'ACCOUNT_NOT_FOUND',
        message: `Account ${nonExistentAccountId} not found`,
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions`,
      });

      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });

    it('should return 400 for invalid limit parameter', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions?limit=0`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(String),
      });
    });

    it('should return 400 for invalid accountId parameter', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/invalid-uuid/transactions`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(String),
      });
    });
  });

  describe('Get Transaction Endpoint', () => {
    let jwtCookie: string;
    let accountId: string;
    let fundingTxnId: string;
    let transferTxnId: string;
    let secondAccountId: string;
    let secondUserJwtCookie: string;

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('get-transaction-user');
      jwtCookie = creds.jwtCookie;

      // Create an account
      const createAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Test Account' },
      });
      expect(createAccount.statusCode).toBe(201);
      accountId = createAccount.body.accountId;

      // Fund the account to create a funding transaction
      const fundResult = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 1000 },
      });
      expect(fundResult.statusCode).toBe(201);
      fundingTxnId = fundResult.body.txnId;

      // Create a second account and transfer money to create a transfer transaction
      const secondUser = await signupUniqueTestUser('get-transaction-user-2');
      secondUserJwtCookie = secondUser.jwtCookie;
      const secondAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie: secondUser.jwtCookie,
        body: { name: 'Second Account' },
      });
      expect(secondAccount.statusCode).toBe(201);
      secondAccountId = secondAccount.body.accountId;

      // Transfer money to create a transfer transaction
      const transferResult = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: accountId,
          destinationAccountNumber: secondAccount.body.accountNumber,
          amountMinor: 300,
        },
      });
      expect(transferResult.statusCode).toBe(201);
      transferTxnId = transferResult.body.txnId;
    });

    it('should get a funding transaction for authenticated user', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions/${fundingTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({
        txnId: fundingTxnId,
        accountId: accountId,
        side: 'CREDIT',
        amountMinor: 1000,
        type: 'FUNDING',
        status: 'POSTED',
        timestamp: expect.any(String),
        description: expect.any(String),
        counterpartyAccountNumber: expect.any(String),
      });

      // Verify timestamp is valid ISO string
      expect(new Date(result.body.timestamp).toISOString()).toBe(
        result.body.timestamp
      );
    });

    it('should get a transfer transaction for authenticated user', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions/${transferTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({
        txnId: transferTxnId,
        accountId: accountId,
        side: 'DEBIT',
        amountMinor: 300,
        type: 'TRANSFER',
        status: 'POSTED',
        timestamp: expect.any(String),
        description: expect.any(String),
        counterpartyAccountNumber: expect.any(String),
      });
    });

    it('should get transaction from recipient account perspective', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${secondAccountId}/transactions/${transferTxnId}`,
        jwtCookie: secondUserJwtCookie,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({
        txnId: transferTxnId,
        accountId: secondAccountId,
        side: 'CREDIT',
        amountMinor: 300,
        type: 'TRANSFER',
        status: 'POSTED',
        timestamp: expect.any(String),
        description: expect.any(String),
        counterpartyAccountNumber: expect.any(String),
      });
    });

    it('should return 404 if transaction does not exist', async () => {
      const nonExistentTxnId = crypto.randomUUID();
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions/${nonExistentTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'TRANSACTION_NOT_FOUND',
        message: expect.any(String),
      });
    });

    it('should return 404 if account does not exist', async () => {
      const nonExistentAccountId = crypto.randomUUID();
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${nonExistentAccountId}/transactions/${fundingTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'TRANSACTION_NOT_FOUND',
        message: expect.any(String),
      });
    });

    it('should return 404 if transaction exists but not for the specified account', async () => {
      // Create a different account
      const differentAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Different Account' },
      });
      expect(differentAccount.statusCode).toBe(201);

      // Try to get funding transaction from different account
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${differentAccount.body.accountId}/transactions/${fundingTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'TRANSACTION_NOT_FOUND',
        message: `Transaction ${fundingTxnId} not found`,
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions/${fundingTxnId}`,
      });

      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    });

    it('should return 400 for invalid accountId parameter', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/invalid-uuid/transactions/${fundingTxnId}`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(String),
      });
    });

    it('should return 400 for invalid txnId parameter', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions/invalid-uuid`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: expect.any(String),
      });
    });
  });

  describe('Activity Endpoint', () => {
    let jwtCookie: string;
    let accountId: string;
    let accountNumber: string;
    let holdRepository: DynamoHoldRepository;
    let releasedHold: {
      holdId: string;
      createdAt: string;
      releasedAt: string;
    };
    let expiredHold: {
      holdId: string;
      createdAt: string;
      expiresAt: string;
    };
    let sortedTransactions: Array<{
      transactionId: string;
      timestamp: string;
      amountMinor: number;
    }>;
    let holdEntries: Array<{
      holdId: string;
      createdAt: string;
      amountMinor: number;
      description: string;
      counterpartyAccountNumber: string;
    }>;
    type ExpectedActivityItem =
      | { kind: 'POSTED_TRANSACTION'; transactionId: string }
      | {
          kind:
            | 'HOLD_CREATED'
            | 'HOLD_RELEASED'
            | 'HOLD_CAPTURED'
            | 'HOLD_FAILED';
          holdId: string;
        };

    const expectedOrder: ExpectedActivityItem[] = [];

    beforeAll(async () => {
      const creds = await signupUniqueTestUser('activity-endpoint-user');
      jwtCookie = creds.jwtCookie;

      const createAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Activity Primary Account' },
      });
      expect(createAccount.statusCode).toBe(201);
      accountId = createAccount.body.accountId;
      accountNumber = createAccount.body.accountNumber;

      const fundingResult = await invokeApi({
        method: 'POST',
        path: `/v1/accounts/${accountId}/funding`,
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: { amountMinor: 1_500 },
      });
      expect(fundingResult.statusCode).toBe(201);

      const destinationAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie,
        body: { name: 'Activity Destination Account' },
      });
      expect(destinationAccount.statusCode).toBe(201);

      const transferResult = await invokeApi({
        method: 'POST',
        path: '/v1/transfers',
        jwtCookie,
        headers: {
          'idempotency-key': crypto.randomUUID(),
          origin: DEFAULT_TEST_ORIGIN,
        },
        body: {
          sourceAccountId: accountId,
          destinationAccountNumber: destinationAccount.body.accountNumber,
          amountMinor: 300,
        },
      });
      expect(transferResult.statusCode).toBe(201);

      const transactionsResponse = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountId}/transactions`,
        jwtCookie,
      });
      expect(transactionsResponse.statusCode).toBe(200);

      sortedTransactions = (
        transactionsResponse.body.items as Array<{
          txnId: string;
          timestamp: string;
          amountMinor: number;
        }>
      )
        .map(item => ({
          transactionId: item.txnId,
          timestamp: item.timestamp,
          amountMinor: item.amountMinor,
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      if (sortedTransactions.length < 2) {
        throw new Error(
          'Expected at least two transactions for activity tests'
        );
      }

      holdRepository = new DynamoHoldRepository({
        tableName: TEST_CONFIG.tableName,
        region: TEST_CONFIG.region,
        endpoint: TEST_CONFIG.localstackEndpoint,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      });

      const newestTime = Date.parse(sortedTransactions[0].timestamp);
      const secondTime = Date.parse(sortedTransactions[1].timestamp);

      holdEntries = [
        {
          holdId: `hold-${crypto.randomUUID()}`,
          createdAt: new Date(newestTime + 2_000).toISOString(),
          amountMinor: 450,
          description: 'Newest pending hold',
          counterpartyAccountNumber: destinationAccount.body.accountNumber,
        },
        {
          holdId: `hold-${crypto.randomUUID()}`,
          createdAt: new Date(
            Math.floor((newestTime + secondTime) / 2)
          ).toISOString(),
          amountMinor: 350,
          description: 'Mid pending hold',
          counterpartyAccountNumber: destinationAccount.body.accountNumber,
        },
        {
          holdId: `hold-${crypto.randomUUID()}`,
          createdAt: new Date(secondTime - 120_000).toISOString(),
          amountMinor: 250,
          description: 'Old pending hold',
          counterpartyAccountNumber: destinationAccount.body.accountNumber,
        },
      ];

      for (const hold of holdEntries) {
        await holdRepository.putHoldMeta({
          holdId: hold.holdId,
          payerAccountNumber: accountNumber,
          counterpartyAccountNumber: hold.counterpartyAccountNumber,
          amountMinor: hold.amountMinor,
          currency: 'USD',
          status: 'PENDING',
          description: hold.description,
          createdAt: hold.createdAt,
        });
        await holdRepository.appendHoldEvent(hold.holdId, {
          at: hold.createdAt,
          type: 'CREATED',
          createdByUserId: 'system-test',
          idempotencyKeyHash: `hash-${hold.holdId}`,
        });
      }

      const captureAt = new Date(newestTime + 1_500).toISOString();
      await holdRepository.putHoldMeta({
        holdId: holdEntries[1].holdId,
        payerAccountNumber: accountNumber,
        counterpartyAccountNumber: holdEntries[1].counterpartyAccountNumber,
        amountMinor: holdEntries[1].amountMinor,
        currency: 'USD',
        status: 'CAPTURED',
        description: holdEntries[1].description,
        createdAt: holdEntries[1].createdAt,
        relatedTransactionId: sortedTransactions[0].transactionId,
      });
      await holdRepository.appendHoldEvent(holdEntries[1].holdId, {
        at: captureAt,
        type: 'CAPTURED',
        transactionId: sortedTransactions[0].transactionId,
        counterpartyAccountNumber: holdEntries[1].counterpartyAccountNumber!,
      });

      releasedHold = {
        holdId: `hold-${crypto.randomUUID()}`,
        createdAt: new Date(secondTime - 30_000).toISOString(),
        releasedAt: new Date(secondTime - 10_000).toISOString(),
      };
      await holdRepository.putHoldMeta({
        holdId: releasedHold.holdId,
        payerAccountNumber: accountNumber,
        amountMinor: 200,
        currency: 'USD',
        status: 'PENDING',
        description: 'Released pending hold',
        createdAt: releasedHold.createdAt,
      });
      await holdRepository.appendHoldEvent(releasedHold.holdId, {
        at: releasedHold.createdAt,
        type: 'CREATED',
        createdByUserId: 'system-test',
      });
      await holdRepository.putHoldMeta({
        holdId: releasedHold.holdId,
        payerAccountNumber: accountNumber,
        amountMinor: 200,
        currency: 'USD',
        status: 'RELEASED',
        description: 'Released pending hold',
        createdAt: releasedHold.createdAt,
        releasedAt: releasedHold.releasedAt,
        releaseReason: 'Merchant adjustment',
      });
      await holdRepository.appendHoldEvent(releasedHold.holdId, {
        at: releasedHold.releasedAt,
        type: 'RELEASED',
        reason: 'Merchant adjustment',
      });

      expectedOrder.push(
        { kind: 'HOLD_CREATED', holdId: holdEntries[0].holdId },
        { kind: 'HOLD_CAPTURED', holdId: holdEntries[1].holdId },
        {
          kind: 'POSTED_TRANSACTION',
          transactionId: sortedTransactions[0].transactionId,
        },
        { kind: 'HOLD_CREATED', holdId: holdEntries[1].holdId },
        {
          kind: 'POSTED_TRANSACTION',
          transactionId: sortedTransactions[1].transactionId,
        },
        { kind: 'HOLD_RELEASED', holdId: releasedHold.holdId },
        { kind: 'HOLD_CREATED', holdId: releasedHold.holdId },
        { kind: 'HOLD_CREATED', holdId: holdEntries[2].holdId }
      );

      expiredHold = {
        holdId: `hold-${crypto.randomUUID()}`,
        createdAt: new Date(secondTime - 180_000).toISOString(),
        expiresAt: new Date(secondTime - 60_000).toISOString(),
      };
      await holdRepository.putHoldMeta({
        holdId: expiredHold.holdId,
        payerAccountNumber: accountNumber,
        amountMinor: 175,
        currency: 'USD',
        status: 'EXPIRED',
        description: 'Expired pending hold',
        createdAt: expiredHold.createdAt,
        expiresAt: expiredHold.expiresAt,
      });
    });

    it('should merge pending holds and posted transactions in descending order', async () => {
      const response = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity`,
        jwtCookie,
      });

      expect(response.statusCode).toBe(200);
      const simplified = response.body.items.map((item: any) => {
        if (item.kind === 'POSTED_TRANSACTION') {
          return { kind: item.kind, transactionId: item.transactionId };
        }
        return { kind: item.kind, holdId: item.holdId };
      });
      expect(simplified).toEqual(expectedOrder);
      expect(response.body.nextCursor).toBeUndefined();

      const newestHoldEvent = response.body.items[0];
      expect(newestHoldEvent).toMatchObject({
        kind: 'HOLD_CREATED',
        holdId: holdEntries[0].holdId,
        amountMinor: holdEntries[0].amountMinor,
        createdByUserId: 'system-test',
        idempotencyKeyHash: `hash-${holdEntries[0].holdId}`,
      });

      const holdIds = response.body.items
        .filter((item: any) => item.kind.startsWith('HOLD_'))
        .map((item: any) => item.holdId);
      expect(holdIds).toContain(releasedHold.holdId);
      expect(holdIds).not.toContain(expiredHold.holdId);

      const capturedEvent = response.body.items.find(
        (item: any) =>
          item.kind === 'HOLD_CAPTURED' && item.holdId === holdEntries[1].holdId
      );
      expect(capturedEvent).toMatchObject({
        transactionId: sortedTransactions[0].transactionId,
        counterpartyAccountNumber: holdEntries[1].counterpartyAccountNumber,
      });

      const releasedEvent = response.body.items.find(
        (item: any) =>
          item.kind === 'HOLD_RELEASED' && item.holdId === releasedHold.holdId
      );
      expect(releasedEvent).toMatchObject({
        releaseReason: 'Merchant adjustment',
        releasedAt: releasedHold.releasedAt,
      });
    });

    it('should support stable pagination with cursor', async () => {
      const firstPage = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity?limit=2`,
        jwtCookie,
      });

      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items).toHaveLength(2);
      const firstIds = firstPage.body.items.map((item: any) => {
        if (item.kind === 'POSTED_TRANSACTION') {
          return { kind: item.kind, transactionId: item.transactionId };
        }
        return { kind: item.kind, holdId: item.holdId };
      });
      expect(firstIds).toEqual(expectedOrder.slice(0, 2));
      expect(firstPage.body.nextCursor).toBeDefined();

      const secondCursor = encodeURIComponent(firstPage.body.nextCursor);
      const secondPage = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity?limit=2&cursor=${secondCursor}`,
        jwtCookie,
      });

      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items).toHaveLength(2);
      const secondIds = secondPage.body.items.map((item: any) => {
        if (item.kind === 'POSTED_TRANSACTION') {
          return { kind: item.kind, transactionId: item.transactionId };
        }
        return { kind: item.kind, holdId: item.holdId };
      });
      expect(secondIds).toEqual(expectedOrder.slice(2, 4));
      expect(secondPage.body.nextCursor).toBeDefined();

      const thirdCursor = encodeURIComponent(secondPage.body.nextCursor);
      const thirdPage = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity?limit=2&cursor=${thirdCursor}`,
        jwtCookie,
      });

      expect(thirdPage.statusCode).toBe(200);
      expect(thirdPage.body.items).toHaveLength(2);
      const thirdIds = thirdPage.body.items.map((item: any) => {
        if (item.kind === 'POSTED_TRANSACTION') {
          return { kind: item.kind, transactionId: item.transactionId };
        }
        return { kind: item.kind, holdId: item.holdId };
      });
      expect(thirdIds).toEqual(expectedOrder.slice(4, 6));
      expect(thirdPage.body.nextCursor).toBeDefined();

      const fourthCursor = encodeURIComponent(thirdPage.body.nextCursor);
      const fourthPage = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity?limit=2&cursor=${fourthCursor}`,
        jwtCookie,
      });

      expect(fourthPage.statusCode).toBe(200);
      expect(fourthPage.body.items).toHaveLength(2);
      const fourthIds = fourthPage.body.items.map((item: any) => {
        if (item.kind === 'POSTED_TRANSACTION') {
          return { kind: item.kind, transactionId: item.transactionId };
        }
        return { kind: item.kind, holdId: item.holdId };
      });
      expect(fourthIds).toEqual(expectedOrder.slice(6));
      expect(fourthPage.body.nextCursor).toBeUndefined();
    });

    it('should return 400 for invalid cursor token', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity?cursor=invalid-token`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toMatchObject({
        error: 'VALIDATION_ERROR',
      });
    });

    it('should return 404 when requesting activity for account not owned by user', async () => {
      const otherUser = await signupUniqueTestUser('activity-endpoint-other');
      const otherAccount = await invokeApi({
        method: 'POST',
        path: '/v1/accounts',
        jwtCookie: otherUser.jwtCookie,
        body: { name: 'Other Account' },
      });
      expect(otherAccount.statusCode).toBe(201);

      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${otherAccount.body.accountNumber}/activity`,
        jwtCookie,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toMatchObject({
        error: 'ACCOUNT_NOT_FOUND',
      });
    });

    it('should return 401 when request is unauthenticated', async () => {
      const result = await invokeApi({
        method: 'GET',
        path: `/v1/accounts/${accountNumber}/activity`,
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
  return `${prefix}-${timestamp}-${randomSuffix}@example.com`;
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
          { AttributeName: 'HOLD_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'HOLD_GSI1SK', AttributeType: 'S' },
          { AttributeName: 'HOLD_EVENT_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'HOLD_EVENT_GSI1SK', AttributeType: 'S' },
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
          {
            IndexName: 'HOLD_GSI1',
            KeySchema: [
              { AttributeName: 'HOLD_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'HOLD_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'HOLD_EVENT_GSI1',
            KeySchema: [
              { AttributeName: 'HOLD_EVENT_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'HOLD_EVENT_GSI1SK', KeyType: 'RANGE' },
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

    // FUNDING_SOURCE META ROW
    const fundingSourceCreatedAt = new Date().toISOString();
    await dynamoClient.send(
      new PutItemCommand({
        TableName: TEST_CONFIG.tableName,
        Item: {
          PK: { S: 'ACCOUNT#FUNDING_SOURCE' },
          SK: { S: 'META' },
          BANKING_GSI1PK: { S: 'USER#SYSTEM' },
          BANKING_GSI1SK: { S: fundingSourceCreatedAt },
          accountNumber: { S: '0000000000' },
          name: { S: 'System Funding Source' },
          ownerUserId: { S: 'SYSTEM' },
          status: { S: 'ACTIVE' },
          currency: { S: 'USD' },
          createdAt: { S: fundingSourceCreatedAt },
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    // FUNDING_SOURCE BALANCE ROW
    await dynamoClient.send(
      new PutItemCommand({
        TableName: TEST_CONFIG.tableName,
        Item: {
          PK: { S: 'ACCOUNT#FUNDING_SOURCE' },
          SK: { S: 'BALANCE' },
          ledgerBalanceMinor: { N: '0' },
          availableBalanceMinor: { N: '0' },
          version: { N: '0' },
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    // FUNDING_SOURCE ACCOUNT NUMBER RESERVATION
    await dynamoClient.send(
      new PutItemCommand({
        TableName: TEST_CONFIG.tableName,
        Item: {
          PK: { S: 'ACCOUNT_NUMBER#0000000000' },
          SK: { S: 'RESERVE' },
          accountId: { S: 'FUNDING_SOURCE' },
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

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
): Promise<{ userId: string; jwtCookie: string; userEmail: string }> {
  const userEmail = generateUniqueTestUserName(namePrefix);
  const signUp = await invokeApi({
    method: 'POST',
    path: isTest ? '/auth/signup?dev=true' : '/auth/signup',
    body: { email: userEmail },
  });
  expect(signUp.statusCode).toBe(201);
  if (!signUp.headers || typeof signUp.headers['set-cookie'] !== 'string') {
    throw new Error('Missing set-cookie header in signUp response');
  }
  return {
    userId: signUp.body.userId,
    jwtCookie: signUp.headers['set-cookie'],
    userEmail,
  };
}
