import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { AwsJwtService } from './AwsJwtService';
import {
  TokenVerificationError,
  TokenExpiredError,
  TokenGenerationError,
} from './errors';

// Mock AWS SDK
const mockSend = vi.fn();
const mockSecretsManagerClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: vi.fn(),
}));

// Get typed access to mocked constructor
const { GetSecretValueCommand } = await import(
  '@aws-sdk/client-secrets-manager'
);
const mockGetSecretValueCommand = vi.mocked(GetSecretValueCommand);

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
  },
}));

describe('AwsJwtService', () => {
  let service: AwsJwtService;
  const mockSecret = 'test-secret-key';
  const mockSecretJson = JSON.stringify({ secret: mockSecret });
  const userId = 'test-user-123';

  // Fixed timestamp for deterministic testing: 2024-01-01T12:00:00Z
  const fixedTimestamp = 1704110400; // Unix timestamp in seconds

  beforeEach(() => {
    // Use fake timers with fixed timestamp
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedTimestamp * 1000));

    vi.clearAllMocks();

    service = new AwsJwtService({
      region: 'us-east-1',
      jwtSecretArn:
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:jwt-secret-abc123',
    });
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
  });

  describe('generateToken', () => {
    it('should generate token for regular user with 1 hour TTL', async () => {
      // Given
      const userId = 'user-123';
      const expectedToken = 'regular-user-token';

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.sign as any).mockReturnValue(expectedToken);

      // When
      const result = await service.generateToken(userId);

      // Then
      expect(result).toBe(expectedToken);
      expect(jwt.sign).toHaveBeenCalledWith(expect.any(Object), mockSecret, {
        algorithm: 'HS256',
      });

      const payload = (jwt.sign as any).mock.calls[0][0];
      expect(payload.sub).toBe(userId);
      expect(payload.isTest).toBeUndefined();

      // Validate exact timestamps (1 hour = 3600 seconds)
      expect(payload.iat).toBe(fixedTimestamp);
      expect(payload.exp).toBe(fixedTimestamp + 3600);
    });

    it('should generate token for test user with 10 minute TTL', async () => {
      // Given
      const userId = 'test-user-123';
      const expectedToken = 'test-user-token';

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.sign as any).mockReturnValue(expectedToken);

      // When
      const result = await service.generateToken(userId, true);

      // Then
      expect(result).toBe(expectedToken);

      // Verify the payload has exact timestamps and correct TTL
      const payload = (jwt.sign as any).mock.calls[0][0];
      expect(payload.sub).toBe(userId);
      expect(payload.isTest).toBe(true);

      // Validate exact timestamps (10 minutes = 600 seconds)
      expect(payload.iat).toBe(fixedTimestamp);
      expect(payload.exp).toBe(fixedTimestamp + 600);
    });

    it('should call Secrets Manager to get JWT secret', async () => {
      // Given
      const userId = 'user-123';

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.sign as any).mockReturnValue('token');

      // When
      await service.generateToken(userId);

      // Then
      // Verify GetSecretValueCommand was created with correct parameters
      expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
        SecretId:
          'arn:aws:secretsmanager:us-east-1:123456789012:secret:jwt-secret-abc123',
      });

      // Verify send was called with the GetSecretValueCommand instance
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify token has exact timestamps
      const usedSecret = (jwt.sign as any).mock.calls[0][1];
      expect(usedSecret).toBe(mockSecret);
    });
  });

  it('should cache JWT secret after first Secrets Manager call', async () => {
    // Given
    const userId = 'user-123';
    mockSend.mockResolvedValueOnce({
      SecretString: mockSecretJson,
    });
    (jwt.sign as any).mockReturnValue('token1');

    // When
    await service.generateToken(userId);

    // Verify first call used GetSecretValueCommand
    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);

    // Reset tracking for second call
    const firstCallCount = mockGetSecretValueCommand.mock.calls.length;
    (jwt.sign as any).mockReturnValue('token2');

    await service.generateToken(userId);

    // Then
    // Verify no additional GetSecretValueCommand was created (cached secret)
    expect(mockGetSecretValueCommand.mock.calls.length).toBe(firstCallCount); // No new commands
    expect(mockSend).toHaveBeenCalledTimes(1); // Still only called once

    // Verify both tokens have the same exact timestamps (cached secret)
    const firstCallSecret = (jwt.sign as any).mock.calls[0][1];
    const secondCallSecret = (jwt.sign as any).mock.calls[1][1];
    expect(firstCallSecret).toBe(secondCallSecret);
  });

  it('should throw TokenGenerationError when jwt.sign fails', async () => {
    // Given
    const userId = 'user-123';
    const jwtError = new Error('JWT signing failed');

    mockSend.mockResolvedValueOnce({
      SecretString: mockSecretJson,
    });
    (jwt.sign as any).mockImplementation(() => {
      throw jwtError;
    });

    // When & Then
    await expect(service.generateToken(userId)).rejects.toThrow(
      new TokenGenerationError(userId, jwtError)
    );

    // Verify GetSecretValueCommand was called to fetch secret
    expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
  });

  describe('verifyToken', () => {
    it('should verify valid token and return payload', async () => {
      // Given
      const token = 'valid-jwt-token';
      const mockPayload = { sub: userId, iat: 123456, exp: 123460 };

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.verify as any).mockReturnValue(mockPayload);

      // When
      const result = await service.verifyToken(token);

      // Then
      expect(result).toEqual(mockPayload);
      expect(jwt.verify).toHaveBeenCalledWith(token, mockSecret, {
        algorithms: ['HS256'],
      });

      // Verify GetSecretValueCommand was created to fetch secret
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
      expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
        SecretId:
          'arn:aws:secretsmanager:us-east-1:123456789012:secret:jwt-secret-abc123',
      });
    });

    it('should throw TokenVerificationError for malformed token', async () => {
      // Given
      const invalidToken = 'invalid-token';
      const jwtError = new Error('jwt malformed');

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.verify as any).mockImplementation(() => {
        throw jwtError;
      });

      // When & Then
      await expect(service.verifyToken(invalidToken)).rejects.toThrow(
        new TokenVerificationError('jwt malformed', jwtError)
      );

      // Verify GetSecretValueCommand was called to fetch secret
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw TokenExpiredError for expired token', async () => {
      // Given
      const expiredToken = 'expired-token';
      const jwtError = new Error('jwt expired');
      jwtError.name = 'TokenExpiredError';

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.verify as any).mockImplementation(() => {
        throw jwtError;
      });

      // When & Then
      await expect(service.verifyToken(expiredToken)).rejects.toThrow(
        new TokenExpiredError(jwtError)
      );

      // Verify GetSecretValueCommand was called to fetch secret
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw TokenVerificationError for invalid signature', async () => {
      // Given
      const invalidSignatureToken = 'invalid-signature-token';
      const jwtError = new Error('invalid signature');
      jwtError.name = 'JsonWebTokenError';

      mockSend.mockResolvedValueOnce({
        SecretString: mockSecretJson,
      });
      (jwt.verify as any).mockImplementation(() => {
        throw jwtError;
      });

      // When & Then
      await expect(service.verifyToken(invalidSignatureToken)).rejects.toThrow(
        new TokenVerificationError('invalid signature', jwtError)
      );

      // Verify GetSecretValueCommand was called to fetch secret
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle Secrets Manager retrieval errors', async () => {
      // Given
      const secretsError = new Error('Secrets Manager Error');
      mockSend.mockRejectedValueOnce(secretsError);

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        new TokenGenerationError(userId)
      );

      // Verify GetSecretValueCommand was attempted
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle missing secret', async () => {
      // Given
      mockSend.mockResolvedValueOnce({
        SecretString: undefined,
      });

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        new TokenGenerationError(userId)
      );

      // Verify GetSecretValueCommand was attempted
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle missing secret key in JSON', async () => {
      // Given
      mockSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({ wrongKey: 'value' }),
      });

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        new TokenGenerationError(userId)
      );

      // Verify GetSecretValueCommand was attempted
      expect(mockGetSecretValueCommand).toHaveBeenCalledTimes(1);
    });
  });
});
