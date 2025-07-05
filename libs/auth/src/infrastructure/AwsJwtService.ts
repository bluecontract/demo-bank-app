import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import jwt from 'jsonwebtoken';
import type { JwtService, JwtPayload } from '../application/ports';
import { UserId } from '../domain/entities/User';
import { InvalidTokenError, TokenExpiredError } from '../domain/errors';
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-observability';

export interface AwsJwtServiceConfig {
  region: string;
  jwtSecretArn: string;
  endpoint?: string; // For LocalStack testing
}

export class AwsJwtService implements JwtService {
  private readonly secretsClient: SecretsManagerClient;
  private readonly jwtSecretArn: string;
  private jwtSecret: string | null = null; // Cache the secret

  constructor(config: AwsJwtServiceConfig) {
    const resilienceConfig = AwsResilienceConfigBuilder.forSecretsManager();
    this.secretsClient = new SecretsManagerClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.jwtSecretArn = config.jwtSecretArn;
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
      const command = new GetSecretValueCommand({
        SecretId: this.jwtSecretArn,
      });

      const response = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new Error(`JWT secret not found: ${this.jwtSecretArn}`);
      }

      const secretData = JSON.parse(response.SecretString);
      if (!secretData.secret || typeof secretData.secret !== 'string') {
        throw new Error(
          `JWT secret key not found in secret: ${this.jwtSecretArn}`
        );
      }

      this.jwtSecret = secretData.secret as string;
      return this.jwtSecret;
    } catch (error) {
      throw new Error(`Failed to retrieve JWT secret: ${error}`);
    }
  }

  private isTokenExpiredError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenExpiredError';
  }
}
