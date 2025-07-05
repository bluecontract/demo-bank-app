import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handler } from './main';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayEventRequestContext,
  Context,
  Callback,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken';

/**
 * Integration Tests - Test against LocalStack AWS services
 * These tests require LocalStack to be running
 */

// Test configuration
const TEST_CONFIG = {
  tableName: 'demo-blue-integration-test',
  jwtSecretArn: '/demo-blue/integration-test/jwt-secret',
  jwtSecret: 'integration-test-jwt-secret-key-12345',
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  jwtTtlSeconds: 3600,
  testUserTtlSeconds: 600,
};

// AWS clients configured for LocalStack
let dynamoClient: DynamoDBClient;
let dynamoDocClient: DynamoDBDocumentClient;
let secretsManagerClient: SecretsManagerClient;

describe('Bank API Integration Tests', () => {
  beforeAll(async () => {
    // Given - LocalStack AWS services are configured
    dynamoClient = new DynamoDBClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

    secretsManagerClient = new SecretsManagerClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    // Set up environment variables for integration testing
    process.env.DYNAMO_TABLE_NAME = TEST_CONFIG.tableName;
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

    delete process.env.DYNAMO_TABLE_NAME;
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

  describe('Health Endpoint - LocalStack Integration', () => {
    it('should return health status with correct format', async () => {
      // Given
      const event: APIGatewayProxyEvent = createTestEvent('GET', '/health');

      // When
      const result = (await handler(
        event,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String),
        environment: expect.any(String),
      });

      const eventWithOrigin = createTestEvent('GET', '/health');
      eventWithOrigin.headers['Origin'] = 'https://app.example.com';

      const corsResult = (await handler(
        eventWithOrigin,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      expect(corsResult.statusCode).toBe(200);
      expect(corsResult.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
      });
    });
  });

  describe('Sign-up Endpoint - LocalStack Integration', () => {
    it('should successfully sign up a new user with valid JWT cookie', async () => {
      // Given
      const testUserName = generateUniqueTestUserName('integration-test-user');
      const event: APIGatewayProxyEvent = createTestEvent(
        'POST',
        '/auth/signup',
        { name: testUserName }
      );

      // When - we call the sign-up handler
      const result = (await handler(
        event,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then - it should return success with user data and auth cookie
      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body).toEqual({
        userId: expect.any(String),
        name: testUserName,
      });

      // And - should set HttpOnly auth cookie
      const cookieHeader = result.headers?.['set-cookie'] as string | undefined;
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('demoAuth=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=None');
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain(`Max-Age=${TEST_CONFIG.jwtTtlSeconds}`);

      // And - JWT token should be valid and contain correct data
      if (!cookieHeader) {
        throw new Error('Cookie header is undefined');
      }
      const token = extractTokenFromCookie(cookieHeader);
      const decoded = jwt.verify(token, TEST_CONFIG.jwtSecret) as any;
      expect(decoded.sub).toBe(body.userId); // JWT uses 'sub' for subject/userId
      expect(decoded.iat).toBeDefined(); // Issued at timestamp
      expect(decoded.exp).toBeDefined(); // Expiration timestamp
      expect(decoded.isTest).toBeUndefined(); // Regular users don't have isTest flag

      // And - user should be stored in DynamoDB with correct structure
      const userData = await getUserFromDynamoDB(body.userId);
      expect(userData).toBeDefined();
      expect(userData).not.toBeNull();
      expect(userData!.name).toBe(testUserName);
      expect(userData!.id).toBe(body.userId);
      expect(userData!.isTest).toBe(false);
      expect(userData!.createdAt).toBeDefined();

      // And - should include CORS headers when Origin is provided
      const corsEvent = createTestEvent('POST', '/auth/signup', {
        name: 'cors-test-' + Date.now(),
      });
      corsEvent.headers['Origin'] = 'https://app.example.com';

      const corsResult = (await handler(
        corsEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      expect(corsResult.statusCode).toBe(201);
      expect(corsResult.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-credentials': 'true',
      });
    });

    it('should return 409 when signing up with existing username', async () => {
      // Given - a user that already exists
      const existingUserName = generateUniqueTestUserName('duplicate-test');
      await handler(
        createTestEvent('POST', '/auth/signup', { name: existingUserName }),
        {} as Context,
        {} as Callback
      );

      // When - attempting to sign up with the same name
      const duplicateSignUpEvent = createTestEvent('POST', '/auth/signup', {
        name: existingUserName,
      });
      const result = (await handler(
        duplicateSignUpEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then - should return 409 Conflict
      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        error: 'USER_ALREADY_EXISTS',
        message:
          'A user with this name already exists. Please choose a different name.',
      });
    });

    it('should return 400 for invalid request data', async () => {
      // Given - invalid sign-up data (empty name)
      const invalidEvent = createTestEvent('POST', '/auth/signup', {
        name: '',
      });

      // When
      const result = (await handler(
        invalidEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('should create test user with shorter TTL when dev=true', async () => {
      // Given
      const testUserName = generateUniqueTestUserName('dev-test-user');
      const devEvent = createTestEvent('POST', '/auth/signup?dev=true', {
        name: testUserName,
      });

      // When
      const result = (await handler(
        devEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(201);

      const cookieHeader = result.headers?.['set-cookie'] as string;
      expect(cookieHeader).toContain(
        `Max-Age=${TEST_CONFIG.testUserTtlSeconds}`
      );

      const body = JSON.parse(result.body);
      const userData = await getUserFromDynamoDB(body.userId);
      expect(userData!.isTest).toBe(true);
    });
  });

  describe('Sign-in Endpoint - LocalStack Integration', () => {
    it('should successfully sign in an existing user with valid JWT cookie', async () => {
      // Given - a user that already exists
      const existingUserName = generateUniqueTestUserName('signin-test-user');
      const signUpResult = (await handler(
        createTestEvent('POST', '/auth/signup', { name: existingUserName }),
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;
      const signUpBody = JSON.parse(signUpResult.body);

      // When - we call the sign-in handler
      const signInEvent = createTestEvent('POST', '/auth/signin', {
        name: existingUserName,
      });
      const result = (await handler(
        signInEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then - it should return success with user data and auth cookie
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toEqual({
        userId: signUpBody.userId,
        name: existingUserName,
      });

      // And - should set HttpOnly auth cookie
      const cookieHeader = result.headers?.['set-cookie'] as string | undefined;
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('demoAuth=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=None');
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain(`Max-Age=${TEST_CONFIG.jwtTtlSeconds}`);

      // And - JWT token should be valid and contain correct data
      if (!cookieHeader) {
        throw new Error('Cookie header is undefined');
      }
      const token = extractTokenFromCookie(cookieHeader);
      const decoded = jwt.verify(token, TEST_CONFIG.jwtSecret) as any;
      expect(decoded.sub).toBe(body.userId);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should return 404 when signing in with non-existing username', async () => {
      // Given - a username that does not exist
      const nonExistentUserName =
        generateUniqueTestUserName('nonexistent-user');

      // When - attempting to sign in
      const signInEvent = createTestEvent('POST', '/auth/signin', {
        name: nonExistentUserName,
      });
      const result = (await handler(
        signInEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then - should return 404 Not Found
      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body).toEqual({
        error: 'USER_NOT_FOUND',
        message: 'User not found. Please check the name and try again.',
      });
    });

    it('should return 400 for invalid sign-in request data', async () => {
      // Given - invalid sign-in data (empty name)
      const invalidEvent = createTestEvent('POST', '/auth/signin', {
        name: '',
      });

      // When
      const result = (await handler(
        invalidEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('should include CORS headers when Origin is provided', async () => {
      // Given - an existing user
      const existingUserName = generateUniqueTestUserName('cors-signin-test');
      await handler(
        createTestEvent('POST', '/auth/signup', { name: existingUserName }),
        {} as Context,
        {} as Callback
      );

      // When - sign in with CORS origin header
      const corsEvent = createTestEvent('POST', '/auth/signin', {
        name: existingUserName,
      });
      corsEvent.headers['Origin'] = 'https://app.example.com';

      const result = (await handler(
        corsEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then
      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-credentials': 'true',
      });
    });

    it('should work with test users created via dev=true', async () => {
      // Given - a test user created with dev=true
      const testUserName = generateUniqueTestUserName('test-signin-user');
      const signUpResult = (await handler(
        createTestEvent('POST', '/auth/signup?dev=true', {
          name: testUserName,
        }),
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;
      const signUpBody = JSON.parse(signUpResult.body);

      // When - sign in with the test user
      const signInEvent = createTestEvent('POST', '/auth/signin', {
        name: testUserName,
      });
      const result = (await handler(
        signInEvent,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResult;

      // Then - should sign in successfully
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.userId).toBe(signUpBody.userId);
      expect(body.name).toBe(testUserName);

      // And - should set JWT with regular TTL (test flag only affects creation)
      const cookieHeader = result.headers?.['set-cookie'] as string;
      expect(cookieHeader).toContain(`Max-Age=600`);
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
  body?: any
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path: path,
    pathParameters: null,
    queryStringParameters: path.includes('?')
      ? Object.fromEntries(new URLSearchParams(path.split('?')[1]))
      : null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    requestContext: {
      requestId: 'test-request-id',
      stage: 'test',
      httpMethod: method,
      path: path,
      accountId: '123456789012',
      resourceId: 'test-resource',
      apiId: 'test-api',
    } as APIGatewayEventRequestContext,
    resource: path,
    stageVariables: null,
    multiValueQueryStringParameters: null,
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
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
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
    await secretsManagerClient.send(
      new CreateSecretCommand({
        Name: TEST_CONFIG.jwtSecretArn,
        SecretString: JSON.stringify({ secret: TEST_CONFIG.jwtSecret }),
        Description: 'JWT secret for integration tests',
      })
    );
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

async function getUserFromDynamoDB(userId: string) {
  try {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: 'PROFILE', // Correct SK structure from DynamoUserRepository
        },
      })
    );
    return result.Item;
  } catch {
    console.error('Failed to get user from DynamoDB');
    return null;
  }
}
