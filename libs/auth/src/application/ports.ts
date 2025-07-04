import { User, UserId } from '../domain/entities/User';
import { AuthConfiguration, MetricUnit } from '../domain/types';

export interface JwtPayload {
  sub: UserId;
  iat: number;
  exp: number;
  isTest?: boolean;
}

// Repository ports
export interface UserRepository {
  save(user: User): Promise<User>;
  findById(id: UserId): Promise<User | null>;
  findByName(name: string): Promise<User | null>;
}

// Service ports
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

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
  setCorrelationId(correlationId: string): void;
}

export interface Metrics {
  addMetric(name: string, unit: MetricUnit, value: number): void;
  addMetadata(key: string, value: string): void;
  publishStoredMetrics(): Promise<void>;
  setDefaultDimensions(dimensions: Record<string, string>): void;
}

export interface Configuration {
  getAuthConfig(): Promise<AuthConfiguration>;
  isTestMode(): boolean;
  getEnvironment(): string;
}
