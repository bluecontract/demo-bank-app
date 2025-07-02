import { UserId } from '../entities/User';

export interface JwtPayload {
  sub: UserId;
  iat: number;
  exp: number;
  isTest?: boolean;
}

export interface JwtService {
  /**
   * Generate a JWT token for a user
   * @param userId The user ID to include in the token
   * @param isTest Whether this is a test user (affects TTL)
   * @returns Promise resolving to the JWT token string
   */
  generateToken(userId: UserId, isTest?: boolean): Promise<string>;

  /**
   * Verify and decode a JWT token
   * @param token The JWT token to verify
   * @returns Promise resolving to the decoded payload
   * @throws InvalidTokenError if token is invalid
   * @throws TokenExpiredError if token has expired
   */
  verifyToken(token: string): Promise<JwtPayload>;
}
