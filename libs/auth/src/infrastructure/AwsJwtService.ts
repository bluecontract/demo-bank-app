import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwt from 'jsonwebtoken';
import { JwtService, JwtPayload } from '../domain/services/JwtService';
import { UserId } from '../domain/entities/User';
import { InvalidTokenError, TokenExpiredError } from '../domain/errors';

export interface AwsJwtServiceConfig {
  region: string;
  jwtSecretParameterName: string;
  endpoint?: string; // For LocalStack testing
}

export class AwsJwtService implements JwtService {
  private readonly ssmClient: SSMClient;
  private readonly jwtSecretParameterName: string;
  private jwtSecret: string | null = null; // Cache the secret

  constructor(config: AwsJwtServiceConfig) {
    this.ssmClient = new SSMClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
    });
    this.jwtSecretParameterName = config.jwtSecretParameterName;
  }

  async generateToken(userId: UserId, isTest?: boolean): Promise<string> {
    const secret = await this.getJwtSecret();
    const now = Math.floor(Date.now() / 1000);

    // Set different TTL for test users (10 minutes vs 1 hour)
    const ttl = isTest ? 10 * 60 : 60 * 60;

    const payload: JwtPayload = {
      sub: userId,
      iat: now,
      exp: now + ttl,
      ...(isTest && { isTest: true }),
    };

    return jwt.sign(payload, secret, { algorithm: 'HS256' });
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    const secret = await this.getJwtSecret();

    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      }) as JwtPayload;
      return payload;
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : undefined;

      if (this.isTokenExpiredError(error)) {
        console.error('Token verification failed - token expired:', {
          error: cause?.message || 'Unknown error',
        });
        throw new TokenExpiredError(cause);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Token verification failed';
      console.error('Token verification failed - invalid token:', {
        error: errorMessage,
      });
      throw new InvalidTokenError(errorMessage, cause);
    }
  }

  private async getJwtSecret(): Promise<string> {
    if (this.jwtSecret) {
      return this.jwtSecret;
    }

    try {
      const command = new GetParameterCommand({
        Name: this.jwtSecretParameterName,
        WithDecryption: true,
      });

      const response = await this.ssmClient.send(command);

      if (!response.Parameter?.Value) {
        throw new Error(
          `JWT secret parameter not found: ${this.jwtSecretParameterName}`
        );
      }

      this.jwtSecret = response.Parameter.Value;
      return this.jwtSecret;
    } catch (error) {
      throw new Error(`Failed to retrieve JWT secret: ${error}`);
    }
  }

  private isTokenExpiredError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenExpiredError';
  }
}
