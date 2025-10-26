import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { AwsJwtService } from './AwsJwtService';
import {
  TokenVerificationError,
  TokenExpiredError,
  TokenGenerationError,
} from './errors';
import { randomUUID } from 'crypto';

const TEST_CONFIG = {
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  secretName: `demo-bank-app-auth-jwt-service-integration-test-${Date.now()}`,
  testSecret: 'test-jwt-secret-key-for-integration-tests',
};

let secretsClient: SecretsManagerClient;
let jwtService: AwsJwtService;
let secretArn: string;

async function setupSecret() {
  const secretValue = JSON.stringify({ secret: TEST_CONFIG.testSecret });

  try {
    const result = await secretsClient.send(
      new CreateSecretCommand({
        Name: TEST_CONFIG.secretName,
        SecretString: secretValue,
        Description: 'Test JWT secret for integration tests',
      })
    );
    secretArn = result.ARN!;
  } catch {
    // If secret already exists, update it
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: TEST_CONFIG.secretName,
        SecretString: secretValue,
      })
    );
    secretArn = `arn:aws:secretsmanager:${TEST_CONFIG.region}:000000000000:secret:${TEST_CONFIG.secretName}`;
  }
}

async function cleanupSecret() {
  try {
    await secretsClient.send(
      new DeleteSecretCommand({
        SecretId: secretArn,
        ForceDeleteWithoutRecovery: true,
      })
    );
  } catch {
    // Ignore cleanup errors
  }
}

describe('AwsJwtService Integration', () => {
  beforeAll(async () => {
    secretsClient = new SecretsManagerClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await setupSecret();
    jwtService = new AwsJwtService({
      region: TEST_CONFIG.region,
      jwtSecretArn: secretArn,
      endpoint: TEST_CONFIG.localstackEndpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  });

  afterAll(async () => {
    await cleanupSecret();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('token generation', () => {
    it('should generate token for regular user', async () => {
      // Given
      const userId = 'user-123';

      // When
      const token = await jwtService.generateToken({
        userId: userId,
        email: 'user-123@example.com',
      });

      // Then
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('should generate token for test user', async () => {
      // Given
      const userId = 'test-user-123';

      // When
      const token = await jwtService.generateToken({
        userId: userId,
        isTest: true,
      });

      // Then
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should generate different tokens for different users', async () => {
      // Given
      const userId1 = 'user-1';
      const userId2 = 'user-2';

      // When
      const token1 = await jwtService.generateToken({ userId: userId1 });
      const token2 = await jwtService.generateToken({ userId: userId2 });

      // Then
      expect(token1).not.toBe(token2);
    });

    it('should generate different tokens for same user at different times', async () => {
      // Given
      const userId = 'user-123';

      // When
      const token1 = await jwtService.generateToken({ userId: userId });

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);

      const token2 = await jwtService.generateToken({ userId: userId });

      // Then
      expect(token1).not.toBe(token2);
    });
  });

  describe('token verification', () => {
    it('should verify valid token and return correct payload', async () => {
      // Given
      const userId = 'user-123';
      const token = await jwtService.generateToken({
        userId: userId,
        email: 'user-123@example.com',
      });

      // When
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.sub).toBe(userId);
      expect(payload.iat).toBe(Math.floor(Date.now() / 1000));
      expect(payload.exp).toBe(Math.floor(Date.now() / 1000) + 3600); // 1 hour
      expect(payload.isTest).toBeUndefined();
      expect(payload.email).toBe('user-123@example.com');
    });

    it('should verify valid test user token with isTest flag', async () => {
      // Given
      const userId = 'test-user-123';
      const token = await jwtService.generateToken({
        userId: userId,
        isTest: true,
        email: 'test-user-123@example.com',
      });

      // When
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.sub).toBe(userId);
      expect(payload.iat).toBe(Math.floor(Date.now() / 1000));
      expect(payload.exp).toBe(Math.floor(Date.now() / 1000) + 600); // 10 minutes
      expect(payload.isTest).toBe(true);
      expect(payload.email).toBe('test-user-123@example.com');
    });

    it('should throw TokenVerificationError for malformed token', async () => {
      // Given
      const invalidToken = 'invalid.token.format';

      // When & Then
      await expect(jwtService.verifyToken(invalidToken)).rejects.toThrow(
        TokenVerificationError
      );
    });

    it('should throw TokenVerificationError for token with invalid signature', async () => {
      // Given
      const userId = 'user-123';
      const token = await jwtService.generateToken({ userId: userId });
      const tamperedToken = token.slice(0, -10) + 'tampered123';

      // When & Then
      await expect(jwtService.verifyToken(tamperedToken)).rejects.toThrow(
        TokenVerificationError
      );
    });

    it('should throw TokenExpiredError for expired token', async () => {
      // Given
      const userId = 'user-123';
      const token = await jwtService.generateToken({ userId: userId });

      // When - advance time beyond token expiry (1 hour + 1 second)
      vi.advanceTimersByTime(3601 * 1000);

      // Then
      await expect(jwtService.verifyToken(token)).rejects.toThrow(
        TokenExpiredError
      );
    });

    it('should throw TokenExpiredError for expired test user token', async () => {
      // Given
      const userId = 'test-user-123';
      const token = await jwtService.generateToken({
        userId: userId,
        isTest: true,
      });

      // When - advance time beyond test token expiry (10 minutes + 1 second)
      vi.advanceTimersByTime(601 * 1000);

      // Then
      await expect(jwtService.verifyToken(token)).rejects.toThrow(
        TokenExpiredError
      );
    });
  });

  describe('round-trip token operations', () => {
    it('should successfully generate and verify regular user token', async () => {
      // Given
      const userId = 'roundtrip-user-123';

      // When
      const token = await jwtService.generateToken({ userId: userId });
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.sub).toBe(userId);
      expect(payload.isTest).toBeUndefined();
    });

    it('should successfully generate and verify test user token', async () => {
      // Given
      const userId = 'roundtrip-test-user-123';

      // When
      const token = await jwtService.generateToken({
        userId: userId,
        isTest: true,
      });
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.sub).toBe(userId);
      expect(payload.isTest).toBe(true);
    });

    it('should maintain token integrity across multiple operations', async () => {
      // Given
      const userIds = ['user-1', 'user-2', 'user-3'];

      // When
      const tokens = await Promise.all(
        userIds.map(userId => jwtService.generateToken({ userId: userId }))
      );

      const payloads = await Promise.all(
        tokens.map(token => jwtService.verifyToken(token))
      );

      // Then
      payloads.forEach((payload, index) => {
        expect(payload.sub).toBe(userIds[index]);
        expect(payload.isTest).toBeUndefined();
      });
    });
  });

  describe('error scenarios', () => {
    it('should handle SecretsManager connection errors gracefully', async () => {
      // Given
      const service = new AwsJwtService({
        region: TEST_CONFIG.region,
        jwtSecretArn: secretArn,
        endpoint: TEST_CONFIG.localstackEndpoint,
      });
      const networkingError = Object.assign(new Error('connect ECONNREFUSED'), {
        name: 'NetworkingError',
      });
      vi.spyOn(
        (service as unknown as { secretsClient: SecretsManagerClient })
          .secretsClient,
        'send'
      ).mockRejectedValueOnce(networkingError);

      const userId = 'user-123';

      // When & Then
      await expect(service.generateToken({ userId })).rejects.toThrow(
        TokenGenerationError
      );
    });

    it('should handle invalid secret ARN gracefully', async () => {
      // Given
      const service = new AwsJwtService({
        region: TEST_CONFIG.region,
        jwtSecretArn:
          'arn:aws:secretsmanager:us-east-1:000000000000:secret:missing',
        endpoint: TEST_CONFIG.localstackEndpoint,
      });
      const secretNotFoundError = Object.assign(new Error('Secret not found'), {
        name: 'ResourceNotFoundException',
      });
      vi.spyOn(
        (service as unknown as { secretsClient: SecretsManagerClient })
          .secretsClient,
        'send'
      ).mockRejectedValueOnce(secretNotFoundError);

      const userId = 'user-123';

      // When & Then
      await expect(service.generateToken({ userId })).rejects.toThrow(
        TokenGenerationError
      );
    });

    it('should throw TokenGenerationError for malformed secret content when generating token', async () => {
      // Given
      const malformedSecretName = `malformed-${Date.now()}-${randomUUID()}`;
      const malformedSecretArn = `arn:aws:secretsmanager:${TEST_CONFIG.region}:000000000000:secret:${malformedSecretName}`;

      // Create secret with malformed content
      await secretsClient.send(
        new CreateSecretCommand({
          Name: malformedSecretName,
          SecretString: JSON.stringify({ wrongKey: 'value' }), // Missing 'secret' key
          Description: 'Test JWT secret for integration tests',
        })
      );

      const malformedService = new AwsJwtService({
        region: TEST_CONFIG.region,
        jwtSecretArn: malformedSecretArn,
        endpoint: TEST_CONFIG.localstackEndpoint,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      });

      const userId = 'user-123';

      // When & Then
      await expect(
        malformedService.generateToken({ userId: userId })
      ).rejects.toThrow(TokenGenerationError);

      // Cleanup
      await secretsClient.send(
        new DeleteSecretCommand({
          SecretId: malformedSecretArn,
          ForceDeleteWithoutRecovery: true,
        })
      );
    });

    it('should throw TokenVerificationError for malformed secret content when verifying token', async () => {
      // Given
      const token = await jwtService.generateToken({ userId: 'user-123' });
      const malformedSecretName = `malformed-${Date.now()}-${randomUUID()}`;
      const malformedSecretArn = `arn:aws:secretsmanager:${TEST_CONFIG.region}:000000000000:secret:${malformedSecretName}`;

      // Create secret with malformed content
      await secretsClient.send(
        new CreateSecretCommand({
          Name: malformedSecretName,
          SecretString: JSON.stringify({ wrongKey: 'value' }), // Missing 'secret' key
        })
      );

      const malformedService = new AwsJwtService({
        region: TEST_CONFIG.region,
        jwtSecretArn: malformedSecretArn,
        endpoint: TEST_CONFIG.localstackEndpoint,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      });

      // When & Then
      await expect(malformedService.verifyToken(token)).rejects.toThrow(
        TokenVerificationError
      );

      // Cleanup
      await secretsClient.send(
        new DeleteSecretCommand({
          SecretId: malformedSecretArn,
          ForceDeleteWithoutRecovery: true,
        })
      );
    });
  });

  describe('secret caching', () => {
    it('should cache secret after first retrieval', async () => {
      // Given
      const userId1 = 'user-1';
      const userId2 = 'user-2';

      // When
      const token1 = await jwtService.generateToken({ userId: userId1 });
      const token2 = await jwtService.generateToken({ userId: userId2 });

      // Then
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);

      // Both tokens should be verifiable (indicating secret was cached)
      const payload1 = await jwtService.verifyToken(token1);
      const payload2 = await jwtService.verifyToken(token2);

      expect(payload1.sub).toBe(userId1);
      expect(payload2.sub).toBe(userId2);
    });
  });

  describe('timing and TTL validation', () => {
    it('should set correct expiration times for regular users', async () => {
      // Given
      const userId = 'user-123';
      const currentTime = Math.floor(Date.now() / 1000);

      // When
      const token = await jwtService.generateToken({ userId: userId });
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.iat).toBe(currentTime);
      expect(payload.exp).toBe(currentTime + 3600); // 1 hour
    });

    it('should set correct expiration times for test users', async () => {
      // Given
      const userId = 'test-user-123';
      const currentTime = Math.floor(Date.now() / 1000);

      // When
      const token = await jwtService.generateToken({
        userId: userId,
        isTest: true,
      });
      const payload = await jwtService.verifyToken(token);

      // Then
      expect(payload.iat).toBe(currentTime);
      expect(payload.exp).toBe(currentTime + 600); // 10 minutes
    });

    it('should handle tokens at expiration boundary', async () => {
      // Given
      const userId = 'user-123';
      const token = await jwtService.generateToken({ userId: userId });

      // When - advance time to just before expiry
      vi.advanceTimersByTime(3599 * 1000); // 59 minutes 59 seconds

      // Then - token should still be valid
      const payload = await jwtService.verifyToken(token);
      expect(payload.sub).toBe(userId);

      // When - advance time to just after expiry
      vi.advanceTimersByTime(2000); // 2 more seconds

      // Then - token should be expired
      await expect(jwtService.verifyToken(token)).rejects.toThrow(
        TokenExpiredError
      );
    });
  });
});
