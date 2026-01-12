import {
  DynamoBankingRepository,
  DynamoHoldRepository,
  SimpleAccountNumberGenerator,
  BankingEnvironmentConfiguration,
  DynamoCardRepository,
  HmacCardHasher,
  CardIssuingEnvironmentConfiguration,
  Account,
  Money,
  FUNDING_SOURCE,
  CARD_SETTLEMENT,
} from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { getLogger } from '../shared/logger';
import { getMetrics } from '../shared/metrics';

let globalDependencies: Awaited<
  ReturnType<typeof initializeDependencies>
> | null = null;

const initializeDependencies = async (
  logger: PowertoolsLogger,
  metrics: PowertoolsMetrics
) => {
  const envConfig = new BankingEnvironmentConfiguration();
  const cardConfig = new CardIssuingEnvironmentConfiguration();

  const awsRegion = process.env.AWS_REGION || 'eu-west-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;

  const repository = new DynamoBankingRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const accountNumberGenerator = new SimpleAccountNumberGenerator();
  const holdRepository = new DynamoHoldRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
    logger,
    metrics,
  });
  const cardRepository = new DynamoCardRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });
  const cardHasher = new HmacCardHasher(
    cardConfig.cardPanSecret,
    cardConfig.cardCvcSecret
  );

  await ensureSystemAccounts(repository, logger);

  return {
    repository,
    holdRepository,
    accountNumberGenerator,
    cardRepository,
    cardHasher,
    logger,
    metrics,
    config: {
      cardConfig,
    },
  };
};

const ensureSystemAccounts = async (
  repository: DynamoBankingRepository,
  logger: PowertoolsLogger
) => {
  const now = new Date();
  const systemAccounts = [
    {
      id: FUNDING_SOURCE.ACCOUNT_ID,
      accountNumber: FUNDING_SOURCE.ACCOUNT_NUMBER,
      name: 'System Funding Source',
    },
    {
      id: CARD_SETTLEMENT.ACCOUNT_ID,
      accountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
      name: 'Card Settlement',
    },
  ];

  await Promise.all(
    systemAccounts.map(async accountInfo => {
      const existing = await repository.getAccountById(accountInfo.id);
      if (existing) {
        return;
      }

      const account = new Account({
        id: accountInfo.id,
        accountNumber: accountInfo.accountNumber,
        name: accountInfo.name,
        ownerUserId: 'SYSTEM',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: now,
        isTest: false,
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
        balanceVersion: 0,
      });

      try {
        await repository.saveAccount(account);
        logger.info('Seeded system account', {
          accountId: accountInfo.id,
          accountNumber: accountInfo.accountNumber,
        });
      } catch (error) {
        const afterSave = await repository.getAccountById(accountInfo.id);
        if (afterSave) {
          return;
        }
        throw error;
      }
    })
  );
};

export const getDependencies = async () => {
  if (!globalDependencies) {
    globalDependencies = await initializeDependencies(
      getLogger(),
      getMetrics()
    );
  }
  return globalDependencies;
};

export const resetDependencies = () => {
  globalDependencies = null;
};
