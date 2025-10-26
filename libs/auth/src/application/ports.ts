import { User } from '../domain/entities/User';
import { AuthConfiguration } from '../domain/types';

export type {
  Logger,
  Metrics,
  MetricUnit,
} from '@demo-bank-app/shared-observability';

export interface JwtPayload {
  sub: User['id'];
  iat: number;
  exp: number;
  isTest?: boolean;
  email?: User['email'];
}

export type GenerateTokenParams = {
  userId: User['id'];
  email?: User['email'];
  isTest?: boolean;
};

// Repository ports
export interface UserRepository {
  save(user: User): Promise<User>;
  findById(id: User['id']): Promise<User | null>;
  findByEmail(email: User['email']): Promise<User | null>;
}

// Service ports
export interface JwtService {
  /**
   * Generate a JWT token for a user
   * @param params.userId The user ID to include in the token
   * @param params.email The user email to include in the token
   * @param params.isTest Whether this is a test user (affects TTL)
   * @returns Promise resolving to the JWT token string
   */
  generateToken(params: GenerateTokenParams): Promise<string>;

  /**
   * Verify and decode a JWT token
   * @param token The JWT token to verify
   * @returns Promise resolving to the decoded payload
   * @throws TokenVerificationError if token is invalid
   * @throws TokenExpiredError if token has expired
   */
  verifyToken(token: string): Promise<JwtPayload>;
}

export interface Configuration {
  getAuthConfig(): Promise<AuthConfiguration>;
  isTestMode(): boolean;
  getEnvironment(): string;
}
