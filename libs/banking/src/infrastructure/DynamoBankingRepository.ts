import {
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Account } from '../domain/entities/Account';
import { Transaction } from '../domain/entities/Transaction';
import { Money } from '../domain/valueObjects/Money';
import {
  BankingRepository,
  TransactionSummary,
  TransactionContext,
} from '../application/ports';
import { PaginationOptions, PaginatedResult } from '../domain/types';
import {
  OptimisticLockError,
  TransactionIdempotencyRecordNotFoundError,
  RepositoryError,
} from './repositoryErrors';
import { PostingSide, Posting } from '../domain/valueObjects/Posting';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type { Logger, Metrics } from '../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import { getIdempotencyKeyHash } from './dynamo/idempotency';
import {
  TABLE_PREFIXES,
  SORT_KEYS,
  GSI_NAMES,
  GSI_PARTITION_KEYS,
  GSI_SORT_KEYS,
  CONDITION_EXPRESSIONS,
  UPDATE_EXPRESSIONS,
  EXPRESSION_ATTRIBUTE_NAMES,
  DYNAMO_ERROR_CODES,
} from './dynamo/constants';
import {
  buildPostingPutItems,
  buildTransactionHeaderPutItem,
  TransactionHeaderItem,
  PostingItem,
} from './dynamo/transactions/items';

export type {
  TransactionHeaderItem,
  PostingItem,
} from './dynamo/transactions/items';

export interface DynamoBankingRepositoryConfig {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  logger?: Logger;
  metrics?: Metrics;
}

// Export database schema interfaces for testing
export interface IdempotencyItem {
  PK: string; // USER#userId
  SK: string; // IDEMPOTENCY#keyHash
  transactionId: string;
  createdAt: string;
  ttl: number;
}

export interface AccountMetaItem {
  PK: string; // ACCOUNT#id
  SK: 'META';
  BANKING_GSI1PK: string;
  BANKING_GSI1SK: string;
  accountNumber: string;
  name: string;
  ownerUserId: string;
  status: string;
  currency: string;
  createdAt: string;
  isTest?: boolean;
}

export interface AccountNumberReservationItem {
  PK: string; // ACCOUNT_NUMBER#accountNumber
  SK: 'RESERVE';
  accountId: string;
}

export interface AccountBalanceItem {
  PK: string; // ACCOUNT#id
  SK: 'BALANCE';
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  version: number;
}

export class DynamoBankingRepository implements BankingRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly logger?: Logger;
  private readonly metrics?: Metrics;

  constructor(config: DynamoBankingRepositoryConfig) {
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.credentials && { credentials: config.credentials }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.tableName;
    this.logger = config.logger;
    this.metrics = config.metrics;
  }

  private buildIdempotencyItem(
    context: TransactionContext,
    transaction: Transaction
  ) {
    const keyHash = getIdempotencyKeyHash(context.idempotencyKey);

    const idempotencyItem: IdempotencyItem = {
      PK: `${TABLE_PREFIXES.USER}${context.userId}`,
      SK: `${TABLE_PREFIXES.IDEMPOTENCY}${keyHash}`,
      transactionId: transaction.id,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    };

    return {
      Put: {
        TableName: this.tableName,
        Item: idempotencyItem,
        ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
      },
    };
  }

  private buildAccountBalanceUpdates(accounts: Account[]) {
    return accounts
      .filter(account => {
        const delta = account.pendingDelta;
        return delta.ledger !== 0 || delta.available !== 0;
      })
      .map(account => {
        const delta = account.pendingDelta;
        return {
          Update: {
            TableName: this.tableName,
            Key: {
              PK: `${TABLE_PREFIXES.ACCOUNT}${account.id}`,
              SK: SORT_KEYS.BALANCE,
            },
            UpdateExpression: UPDATE_EXPRESSIONS.UPDATE_BALANCE,
            ConditionExpression: CONDITION_EXPRESSIONS.BALANCE_VERSION_CHECK,
            ExpressionAttributeNames: {
              [EXPRESSION_ATTRIBUTE_NAMES.VERSION]: 'version',
            },
            ExpressionAttributeValues: {
              ':ledger': delta.ledger,
              ':available': delta.available,
              ':currentVersion': account.balanceVersion,
              ':inc': 1,
            },
          },
        };
      });
  }

  private async handleTransactionSaveError(
    error: unknown,
    transaction: Transaction,
    context: TransactionContext
  ): Promise<string | never> {
    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[0]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      return this.getTransactionIdByIdempotencyKey(
        context.userId,
        context.idempotencyKey
      );
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.some(
        reason => reason.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      )
    ) {
      throw new OptimisticLockError(`transaction_save_${transaction.id}`);
    }

    throw new RepositoryError(
      `transaction_save_(${transaction.id})`,
      error as Error
    );
  }

  private isValidAccountBalanceItem(item: unknown): item is AccountBalanceItem {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      'ledgerBalanceMinor' in record &&
      'availableBalanceMinor' in record &&
      'version' in record &&
      typeof record.ledgerBalanceMinor === 'number' &&
      typeof record.availableBalanceMinor === 'number' &&
      typeof record.version === 'number'
    );
  }

  private isValidAccountMetaItem(item: unknown): item is AccountMetaItem {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      'accountNumber' in record &&
      'name' in record &&
      'ownerUserId' in record &&
      'status' in record &&
      'currency' in record &&
      'createdAt' in record &&
      typeof record.accountNumber === 'string' &&
      typeof record.name === 'string' &&
      typeof record.ownerUserId === 'string' &&
      typeof record.status === 'string' &&
      typeof record.currency === 'string' &&
      typeof record.createdAt === 'string'
    );
  }

  private isValidTransactionHeaderItem(
    item: unknown
  ): item is TransactionHeaderItem {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      'type' in record &&
      'status' in record &&
      'createdAt' in record &&
      'description' in record &&
      'transactionId' in record &&
      typeof record.type === 'string' &&
      typeof record.status === 'string' &&
      typeof record.createdAt === 'string' &&
      typeof record.description === 'string' &&
      typeof record.transactionId === 'string'
    );
  }

  private isValidPostingItem(item: unknown): item is PostingItem {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      'accountId' in record &&
      'amount' in record &&
      'side' in record &&
      'accountNumber' in record &&
      'counterpartyAccountNumber' in record &&
      'transactionId' in record &&
      typeof record.accountId === 'string' &&
      typeof record.amount === 'number' &&
      typeof record.side === 'string' &&
      typeof record.accountNumber === 'string' &&
      typeof record.counterpartyAccountNumber === 'string' &&
      typeof record.transactionId === 'string'
    );
  }

  async saveTransactionWithAccounts(
    transaction: Transaction,
    accounts: Account[],
    context: TransactionContext
  ): Promise<Transaction['id']> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING.REPOSITORY_SAVE_TRANSACTION
    );

    this.logger?.debug('Repository save transaction started', {
      transactionId: transaction.id,
      transactionType: transaction.type,
      accountCount: accounts.length,
      userId: context.userId,
      idempotencyKey: context.idempotencyKey,
      ...TimingUtils.createTimingMetadata(timing),
    });

    try {
      const transactItems = [];

      if (context.idempotencyKey) {
        transactItems.push(this.buildIdempotencyItem(context, transaction));
      }

      transactItems.push(
        buildTransactionHeaderPutItem(this.tableName, transaction)
      );

      transactItems.push(...buildPostingPutItems(this.tableName, transaction));

      transactItems.push(...this.buildAccountBalanceUpdates(accounts));

      const command = new TransactWriteCommand({
        TransactItems: transactItems,
      });

      await this.client.send(command);
      accounts.forEach(account => {
        account.flushPendingDelta();
        account.balanceVersion++;
      });

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING.REPOSITORY_SAVE_TRANSACTION_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('Repository save transaction completed', {
        transactionId: transaction.id,
        transactionType: transaction.type,
        accountCount: accounts.length,
        userId: context.userId,
        idempotencyKey: context.idempotencyKey,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return transaction.id;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('Repository save transaction failed', {
        transactionId: transaction.id,
        transactionType: transaction.type,
        accountCount: accounts.length,
        userId: context.userId,
        idempotencyKey: context.idempotencyKey,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING.REPOSITORY_SAVE_TRANSACTION_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      return this.handleTransactionSaveError(error, transaction, context);
    }
  }

  async saveAccount(account: Account): Promise<Account> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING.REPOSITORY_SAVE_ACCOUNT
    );

    this.logger?.debug('Repository save account started', {
      accountId: account.id,
      accountNumber: account.accountNumber,
      ownerUserId: account.ownerUserId,
      ...TimingUtils.createTimingMetadata(timing),
    });

    try {
      const accountItem = {
        PK: `${TABLE_PREFIXES.ACCOUNT}${account.id}`,
        SK: SORT_KEYS.META,
        [GSI_PARTITION_KEYS.BANKING_GSI1PK]: `${TABLE_PREFIXES.USER}${account.ownerUserId}`,
        [GSI_SORT_KEYS.BANKING_GSI1SK]: account.createdAt.toISOString(),
        accountNumber: account.accountNumber,
        name: account.name,
        ownerUserId: account.ownerUserId,
        status: account.status,
        currency: account.currency,
        createdAt: account.createdAt.toISOString(),
        isTest: account.isTest,
      };

      const balanceItem = {
        PK: `${TABLE_PREFIXES.ACCOUNT}${account.id}`,
        SK: SORT_KEYS.BALANCE,
        [GSI_PARTITION_KEYS.BANKING_GSI1PK]: `${TABLE_PREFIXES.USER}${account.ownerUserId}`,
        [GSI_SORT_KEYS.BANKING_GSI1SK]: account.createdAt.toISOString(),
        ledgerBalanceMinor: account.ledgerBalanceMinor.toCents(),
        availableBalanceMinor: account.availableBalanceMinor.toCents(),
        version: account.balanceVersion,
      };

      const reservationItem = {
        PK: `${TABLE_PREFIXES.ACCOUNT_NUMBER}${account.accountNumber}`,
        SK: SORT_KEYS.RESERVE,
        accountId: account.id,
      };

      const command = new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: accountItem,
              ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: balanceItem,
              ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: reservationItem,
              ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
            },
          },
        ],
      });

      await this.client.send(command);

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING.REPOSITORY_SAVE_ACCOUNT_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('Repository save account completed', {
        accountId: account.id,
        accountNumber: account.accountNumber,
        ownerUserId: account.ownerUserId,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return account;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('Repository save account failed', {
        accountId: account.id,
        accountNumber: account.accountNumber,
        ownerUserId: account.ownerUserId,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING.REPOSITORY_SAVE_ACCOUNT_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      throw new RepositoryError(`save_account(${account.id})`, error as Error);
    }
  }

  async getAccountById(id: string): Promise<Account | null> {
    const command = new BatchGetCommand({
      RequestItems: {
        [this.tableName]: {
          Keys: [
            { PK: `${TABLE_PREFIXES.ACCOUNT}${id}`, SK: SORT_KEYS.META },
            {
              PK: `${TABLE_PREFIXES.ACCOUNT}${id}`,
              SK: SORT_KEYS.BALANCE,
            },
          ],
        },
      },
    });

    try {
      const result = await this.client.send(command);
      const items = result.Responses?.[this.tableName] || [];

      const metaItem = items.find(item => item.SK === SORT_KEYS.META);
      const balanceItem = items.find(item => item.SK === SORT_KEYS.BALANCE);

      if (!metaItem) {
        return null;
      }
      if (!this.isValidAccountMetaItem(metaItem)) {
        throw new Error('Invalid account meta item: corrupted data');
      }
      if (!balanceItem) {
        throw new Error('Invalid account balance item: missing balance');
      }
      if (!this.isValidAccountBalanceItem(balanceItem)) {
        throw new Error('Invalid account balance item: corrupted data');
      }

      const account = this.mapToAccount(metaItem, balanceItem);

      return account;
    } catch (error: unknown) {
      throw new RepositoryError(`get_account_by_id(${id})`, error as Error);
    }
  }

  async getAccountIdByNumber(accountNumber: string): Promise<string | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: `${TABLE_PREFIXES.ACCOUNT_NUMBER}${accountNumber}`,
        SK: SORT_KEYS.RESERVE,
      },
    });

    try {
      const result = await this.client.send(command);
      if (!result.Item) {
        return null;
      }
      if (!result.Item.accountId) {
        throw new Error('Invalid account reservationitem: missing accountId');
      }

      return result.Item.accountId;
    } catch (error: unknown) {
      throw new RepositoryError(
        `get_account_id_by_number(${accountNumber})`,
        error as Error
      );
    }
  }

  async getAccountsByUserId(userId: string): Promise<Account[]> {
    const userAccountsCommand = new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI_NAMES.BANKING_GSI1,
      KeyConditionExpression: `${GSI_PARTITION_KEYS.BANKING_GSI1PK} = :pk`,
      ExpressionAttributeValues: {
        ':pk': `${TABLE_PREFIXES.USER}${userId}`,
      },
    });

    try {
      const result = await this.client.send(userAccountsCommand);
      if (!result.Items || result.Items.length === 0) {
        return [];
      }

      if (result.Items.length % 2 !== 0) {
        throw new Error('Invalid account item: missing meta or balance');
      }

      const accounts = result.Items.reduce((acc, item) => {
        if (!acc[item.PK]) {
          acc[item.PK] = {};
        }
        if (item.SK === SORT_KEYS.META) {
          acc[item.PK].meta = item;
        }
        if (item.SK === SORT_KEYS.BALANCE) {
          acc[item.PK].balance = item;
        }
        return acc;
      }, {});

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      return Object.entries(accounts).map(([_, account]) => {
        if (
          !this.isValidAccountMetaItem(account.meta) ||
          !this.isValidAccountBalanceItem(account.balance)
        ) {
          throw new Error('Invalid account item: corrupted data');
        }
        return this.mapToAccount(account.meta, account.balance);
      });
    } catch (error: unknown) {
      throw new RepositoryError(
        `get_accounts_by_user(${userId})`,
        error as Error
      );
    }
  }

  async getTransactionsByAccount(
    accountId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<TransactionSummary>> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI_NAMES.BANKING_GSI2,
      KeyConditionExpression: `${GSI_PARTITION_KEYS.BANKING_GSI2PK} = :pk AND begins_with(${GSI_SORT_KEYS.BANKING_GSI2SK}, :sk)`,
      ExpressionAttributeValues: {
        ':pk': `${TABLE_PREFIXES.ACCOUNT}${accountId}`,
        ':sk': TABLE_PREFIXES.POSTING,
      },
      ScanIndexForward: false, // Most recent first
      Limit: options.limit || 50,
      ExclusiveStartKey: options.nextToken
        ? JSON.parse(options.nextToken)
        : undefined,
    });

    try {
      const result = await this.client.send(command);
      for (const item of result.Items || []) {
        if (!this.isValidPostingItem(item)) {
          throw new Error('Invalid posting item: corrupted data');
        }
      }
      const items = ((result.Items || []) as PostingItem[]).map(item => ({
        transactionId: item.transactionId,
        type: item.type as Transaction['type'],
        status: item.status as Transaction['status'],
        amount: new Money(item.amount),
        side: item.side as PostingSide,
        description: item.description,
        accountNumber: item.accountNumber,
        counterpartyAccountNumber: item.counterpartyAccountNumber,
        createdAt: new Date(item.createdAt),
        originHoldId: item.originHoldId,
        cardId: item.cardId,
        cardLast4: item.cardLast4,
        merchantName: item.merchantName,
        merchantStatementDescriptor: item.merchantStatementDescriptor,
        merchantCategoryCode: item.merchantCategoryCode,
        merchantCountry: item.merchantCountry,
        processorChargeId: item.processorChargeId,
      }));

      return {
        items,
        nextToken: result.LastEvaluatedKey
          ? JSON.stringify(result.LastEvaluatedKey)
          : undefined,
        hasMore: !!result.LastEvaluatedKey,
      };
    } catch (error: unknown) {
      throw new RepositoryError(
        `get_transactions_by_account(${accountId})`,
        error as Error
      );
    }
  }

  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `${TABLE_PREFIXES.TRANSACTION}${transactionId}`,
      },
    });

    try {
      const result = await this.client.send(command);
      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      const headerItem = result.Items.find(item => item.SK === SORT_KEYS.META);
      if (!headerItem || !this.isValidTransactionHeaderItem(headerItem)) {
        return null;
      }

      const postingItems = result.Items.filter(item =>
        item.SK.startsWith(TABLE_PREFIXES.POSTING)
      );

      // Validate all posting items
      for (const item of postingItems) {
        if (!this.isValidPostingItem(item)) {
          throw new Error('Invalid posting item: corrupted data');
        }
      }

      const postings = postingItems.map(
        item =>
          new Posting({
            accountId: item.accountId,
            amount: new Money(item.amount),
            side: item.side as PostingSide,
            accountNumber: item.accountNumber,
            counterpartyAccountNumber: item.counterpartyAccountNumber,
          })
      );

      return new Transaction({
        id: headerItem.transactionId,
        type: headerItem.type as Transaction['type'],
        status: headerItem.status as Transaction['status'],
        postings,
        description: headerItem.description,
        transactionIdempotencyKey: headerItem.transactionIdempotencyKey,
        createdAt: new Date(headerItem.createdAt),
        originHoldId: headerItem.originHoldId,
        payNoteEventId: headerItem.payNoteEventId,
        cardId: headerItem.cardId,
        cardLast4: headerItem.cardLast4,
        merchantName: headerItem.merchantName,
        merchantStatementDescriptor: headerItem.merchantStatementDescriptor,
        merchantCategoryCode: headerItem.merchantCategoryCode,
        merchantCountry: headerItem.merchantCountry,
        processorChargeId: headerItem.processorChargeId,
      });
    } catch (error: unknown) {
      throw new RepositoryError(
        `get_transaction_by_id(${transactionId})`,
        error as Error
      );
    }
  }

  private mapToAccount(
    meta: AccountMetaItem,
    balance: AccountBalanceItem
  ): Account {
    const accountId = meta.PK.replace(TABLE_PREFIXES.ACCOUNT, '');

    return new Account({
      id: accountId,
      accountNumber: meta.accountNumber,
      name: meta.name,
      ownerUserId: meta.ownerUserId,
      status: meta.status as Account['status'],
      currency: meta.currency as Account['currency'],
      createdAt: new Date(meta.createdAt),
      isTest: meta.isTest ?? false,
      ledgerBalanceMinor: new Money(balance.ledgerBalanceMinor),
      availableBalanceMinor: new Money(balance.availableBalanceMinor),
      balanceVersion: balance.version,
    });
  }

  private async getTransactionIdByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<string> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: `${TABLE_PREFIXES.USER}${userId}`,
        SK: `${TABLE_PREFIXES.IDEMPOTENCY}${getIdempotencyKeyHash(
          idempotencyKey
        )}`,
      },
      ProjectionExpression: 'transactionId',
      ConsistentRead: true,
    });

    const result = await this.client.send(command);
    if (!result.Item || !result.Item.transactionId) {
      throw new TransactionIdempotencyRecordNotFoundError(idempotencyKey);
    }
    return result.Item.transactionId;
  }
}
