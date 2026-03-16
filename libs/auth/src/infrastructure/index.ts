// Repository implementations
export { AwsJwtService } from './AwsJwtService';
export type { AwsJwtServiceConfig } from './AwsJwtService';
export { DynamoUserRepository } from './DynamoUserRepository';
export type { DynamoUserRepositoryConfig } from './DynamoUserRepository';
export { DynamoMerchantDirectoryRepository } from './DynamoMerchantDirectoryRepository';
export type { DynamoMerchantDirectoryRepositoryConfig } from './DynamoMerchantDirectoryRepository';

// Service implementations
export { AuthEnvironmentConfiguration } from './AuthConfiguration';
export { ConfigurationValidationError } from '@demo-bank-app/shared-config';
export {
  TokenGenerationError,
  TokenVerificationError,
  TokenExpiredError,
  TokenServiceError,
  UserAlreadyExistsError,
  UserNotFoundError,
  AuthRepositoryError,
  MerchantDirectoryOwnershipError,
} from './errors';
