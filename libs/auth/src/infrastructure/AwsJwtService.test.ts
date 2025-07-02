import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { AwsJwtService } from './AwsJwtService';
import { UserId } from '../domain/entities/User';
import { InvalidTokenError, TokenExpiredError } from '../domain/errors';

// Mock AWS SDK
const mockSend = vi.fn();
const mockSSMClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => mockSSMClient),
  GetParameterCommand: vi.fn(),
}));

// Get typed access to mocked constructor
const { GetParameterCommand } = await import('@aws-sdk/client-ssm');
const mockGetParameterCommand = vi.mocked(GetParameterCommand);

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
  const userId = 'test-user-123' as UserId;

  // Fixed timestamp for deterministic testing: 2024-01-01T12:00:00Z
  const fixedTimestamp = 1704110400; // Unix timestamp in seconds

  beforeEach(() => {
    // Use fake timers with fixed timestamp
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedTimestamp * 1000));

    vi.clearAllMocks();

    service = new AwsJwtService({
      region: 'us-east-1',
      jwtSecretParameterName: '/app/jwt-secret',
    });
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
  });

  describe('generateToken', () => {
    it('should generate token for regular user with 1 hour TTL', async () => {
      // Given
      const userId = 'user-123' as UserId;
      const expectedToken = 'regular-user-token';

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
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
      const userId = 'test-user-123' as UserId;
      const expectedToken = 'test-user-token';

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
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

    it('should call SSM to get JWT secret parameter', async () => {
      // Given
      const userId = 'user-123' as UserId;

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
      });
      (jwt.sign as any).mockReturnValue('token');

      // When
      await service.generateToken(userId);

      // Then
      // Verify GetParameterCommand was created with correct parameters
      expect(mockGetParameterCommand).toHaveBeenCalledWith({
        Name: '/app/jwt-secret',
        WithDecryption: true,
      });

      // Verify send was called with the GetParameterCommand instance
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify token has exact timestamps
      const usedSecret = (jwt.sign as any).mock.calls[0][1];
      expect(usedSecret).toBe(mockSecret);
    });
  });

  it('should cache JWT secret after first SSM call', async () => {
    // Given
    const userId = 'user-123' as UserId;
    mockSend.mockResolvedValueOnce({
      Parameter: { Value: mockSecret },
    });
    (jwt.sign as any).mockReturnValue('token1');

    // When
    await service.generateToken(userId);

    // Verify first call used GetParameterCommand
    expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);

    // Reset tracking for second call
    const firstCallCount = mockGetParameterCommand.mock.calls.length;
    (jwt.sign as any).mockReturnValue('token2');

    await service.generateToken(userId);

    // Then
    // Verify no additional GetParameterCommand was created (cached secret)
    expect(mockGetParameterCommand.mock.calls.length).toBe(firstCallCount); // No new commands
    expect(mockSend).toHaveBeenCalledTimes(1); // Still only called once

    // Verify both tokens have the same exact timestamps (cached secret)
    const firstCallSecret = (jwt.sign as any).mock.calls[0][1];
    const secondCallSecret = (jwt.sign as any).mock.calls[1][1];
    expect(firstCallSecret).toBe(secondCallSecret);
  });

  describe('verifyToken', () => {
    it('should verify valid token and return payload', async () => {
      // Given
      const token = 'valid-jwt-token';
      const mockPayload = { sub: userId, iat: 123456, exp: 123460 };

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
      });
      (jwt.verify as any).mockReturnValue(mockPayload);

      // When
      const result = await service.verifyToken(token);

      // Then
      expect(result).toEqual(mockPayload);
      expect(jwt.verify).toHaveBeenCalledWith(token, mockSecret, {
        algorithms: ['HS256'],
      });

      // Verify GetParameterCommand was created to fetch secret
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
      expect(mockGetParameterCommand).toHaveBeenCalledWith({
        Name: '/app/jwt-secret',
        WithDecryption: true,
      });
    });

    it('should throw InvalidTokenError for malformed token', async () => {
      // Given
      const invalidToken = 'invalid-token';

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
      });
      (jwt.verify as any).mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      // When & Then
      await expect(service.verifyToken(invalidToken)).rejects.toThrow(
        InvalidTokenError
      );

      // Verify GetParameterCommand was called to fetch secret
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw TokenExpiredError for expired token', async () => {
      // Given
      const expiredToken = 'expired-token';

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
      });
      (jwt.verify as any).mockImplementation(() => {
        const error = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        throw error;
      });

      // When & Then
      await expect(service.verifyToken(expiredToken)).rejects.toThrow(
        TokenExpiredError
      );

      // Verify GetParameterCommand was called to fetch secret
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw InvalidTokenError for invalid signature', async () => {
      // Given
      const invalidSignatureToken = 'invalid-signature-token';

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: mockSecret },
      });
      (jwt.verify as any).mockImplementation(() => {
        const error = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        throw error;
      });

      // When & Then
      await expect(service.verifyToken(invalidSignatureToken)).rejects.toThrow(
        InvalidTokenError
      );

      // Verify GetParameterCommand was called to fetch secret
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle SSM parameter retrieval errors', async () => {
      // Given
      mockSend.mockRejectedValueOnce(new Error('SSM Error'));

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        'Failed to retrieve JWT secret: Error: SSM Error'
      );

      // Verify GetParameterCommand was attempted
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle missing SSM parameter', async () => {
      // Given
      mockSend.mockResolvedValueOnce({
        Parameter: undefined,
      });

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        'JWT secret parameter not found: /app/jwt-secret'
      );

      // Verify GetParameterCommand was attempted
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle missing SSM parameter value', async () => {
      // Given
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: undefined },
      });

      // When & Then
      await expect(service.generateToken(userId)).rejects.toThrow(
        'JWT secret parameter not found: /app/jwt-secret'
      );

      // Verify GetParameterCommand was attempted
      expect(mockGetParameterCommand).toHaveBeenCalledTimes(1);
    });
  });
});
