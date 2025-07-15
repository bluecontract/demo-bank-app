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
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-config';
import type { Logger, Metrics } from '@demo-blue/shared-observability';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-blue/shared-observability';

export interface AwsJwtServiceConfig {
  region: string;
  jwtSecretArn: string;
  endpoint?: string; // For LocalStack testing
  credentials?: { accessKeyId: string; secretAccessKey: string };
  logger?: Logger;
  metrics?: Metrics;
}

export class AwsJwtService implements JwtService {
  private readonly secretsClient: SecretsManagerClient;
  private readonly jwtSecretArn: string;
  private jwtSecret: string | null = null; // Cache the secret
  private readonly logger?: Logger;
  private readonly metrics?: Metrics;

  constructor(config: AwsJwtServiceConfig) {
    const resilienceConfig = AwsResilienceConfigBuilder.forSecretsManager();
    this.secretsClient = new SecretsManagerClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.credentials && { credentials: config.credentials }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.jwtSecretArn = config.jwtSecretArn;
    this.logger = config.logger;
    this.metrics = config.metrics;
  }

  async generateToken(userId: User['id'], isTest?: boolean): Promise<string> {
    const timing = TimingUtils.startTiming(OPERATION_NAMES.AUTH.JWT_GENERATE);

    this.logger?.debug('JWT token generation started', {
      userId,
      isTest: isTest || false,
      ...TimingUtils.createTimingMetadata(timing),
    });

    try {
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

      const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.JWT_GENERATE_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('JWT token generation completed', {
        userId,
        isTest: isTest || false,
        tokenLength: token.length,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return token;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('JWT token generation failed', {
        userId,
        isTest: isTest || false,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.JWT_GENERATE_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      const cause = error instanceof Error ? error : undefined;
      throw new TokenGenerationError(userId, cause);
    }
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    const timing = TimingUtils.startTiming(OPERATION_NAMES.AUTH.JWT_VERIFY);

    this.logger?.debug('JWT token verification started', {
      tokenLength: token.length,
      ...TimingUtils.createTimingMetadata(timing),
    });

    try {
      const secret = await this.getJwtSecret();

      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      }) as JwtPayload;

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.JWT_VERIFY_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('JWT token verification completed', {
        userId: payload.sub,
        isTest: payload.isTest || false,
        tokenLength: token.length,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return payload;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.warn('JWT token verification failed', {
        tokenLength: token.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.JWT_VERIFY_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

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

    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.INFRASTRUCTURE.AWS_SECRETS_OPERATION
    );

    this.logger?.debug('JWT secret retrieval started', {
      secretArn: this.jwtSecretArn,
      ...TimingUtils.createTimingMetadata(timing),
    });

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

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.INFRASTRUCTURE.AWS_SECRETS_OPERATION_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('JWT secret retrieval completed', {
        secretArn: this.jwtSecretArn,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return this.jwtSecret;
    } catch (error) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('JWT secret retrieval failed', {
        secretArn: this.jwtSecretArn,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.INFRASTRUCTURE.AWS_SECRETS_OPERATION_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

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
