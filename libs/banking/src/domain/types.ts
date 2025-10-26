// Re-export common types from entities and value objects
export type { AccountStatus, Currency } from './entities/Account';
export type {
  TransactionType,
  TransactionStatus,
  TransactionMeta,
  NetAmount,
} from './entities/Transaction';
export type { PostingSide, Side } from './valueObjects/Posting';

// Shared types from observability
import type { LogLevel } from '@demo-bank-app/shared-observability';

export type {
  LogLevel,
  Logger,
  Metrics,
  MetricUnit,
} from '@demo-bank-app/shared-observability';

// Configuration interfaces
export interface BankingConfiguration {
  dynamoTableName: string;
  environment: string;
  serviceName: string;
  logLevel: LogLevel;
  metricsNamespace: string;
}

// Pagination types
export interface PaginationOptions {
  limit?: number;
  nextToken?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string;
  hasMore: boolean;
}

// Common result types
export type PaginatedTransactions = PaginatedResult<
  import('./entities/Transaction').Transaction
>;
