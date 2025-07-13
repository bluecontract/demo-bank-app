import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import jwt from 'jsonwebtoken';
import type { JwtService, JwtPayload } from '../application/ports';
import { User } from '../domain/entities/User';
import {
  TokenVerificationError,
  TokenExpiredError,
  TokenGenerationError,
  TokenServiceError,
} from './errors';
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-observability';

export interface AwsJwtServiceConfig {
  region: string;
  jwtSecretArn: string;
  endpoint?: string; // For LocalStack testing
  credentials?: { accessKeyId: string; secretAccessKey: string };
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
      ...(config.credentials && { credentials: config.credentials }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.jwtSecretArn = config.jwtSecretArn;
  }

  async generateToken(userId: User['id'], isTest?: boolean): Promise<string> {
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
    try {
      return jwt.sign(payload, secret, { algorithm: 'HS256' });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : undefined;
      throw new TokenGenerationError(userId, cause);
    }
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
        throw new TokenExpiredError(cause);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Token verification failed';

      throw new TokenVerificationError(errorMessage, cause);
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
        throw new TokenServiceError(
          `JWT secret not found: ${this.jwtSecretArn}`
        );
      }

      const secretData = JSON.parse(response.SecretString);
      if (!secretData.secret || typeof secretData.secret !== 'string') {
        throw new TokenServiceError(
          `JWT secret key not found in secret: ${this.jwtSecretArn}`
        );
      }

      this.jwtSecret = secretData.secret as string;
      return this.jwtSecret;
    } catch (error) {
      if (error instanceof TokenServiceError) {
        throw error;
      }
      const cause = error instanceof Error ? error : undefined;
      throw new TokenServiceError(
        `Failed to retrieve JWT secret from ${this.jwtSecretArn}`,
        cause
      );
    }
  }

  private isTokenExpiredError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenExpiredError';
  }
}
