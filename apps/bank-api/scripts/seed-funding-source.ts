import type { Handler, Context } from 'aws-lambda';
import {
  DynamoBankingRepository,
  Account,
  CARD_SETTLEMENT,
  FUNDING_SOURCE,
  Money,
} from '@demo-bank-app/banking';

interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType: string;
  ResourceProperties: Record<string, unknown>;
}

type CloudFormationCustomResourceHandler = Handler<
  CloudFormationCustomResourceEvent,
  void
>;

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';

// Create banking repository instance lazily
const createRepository = () => {
  console.log('Creating DynamoDB banking repository with:', {
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_REGION,
    tableName: process.env.TABLE,
  });

  return new DynamoBankingRepository({
    tableName: process.env.TABLE || 'BANK_DDB_TABLE_NEEDS_TO_BE_SET',
    region: process.env.AWS_REGION || 'eu-west-1',
    ...(process.env.AWS_ENDPOINT_URL
      ? { endpoint: process.env.AWS_ENDPOINT_URL }
      : {}),
  });
};

const sendResponse = async (
  event: CloudFormationCustomResourceEvent,
  context: Context,
  responseStatus: 'SUCCESS' | 'FAILED',
  responseData: Record<string, unknown> = {}
): Promise<void> => {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: 'FundingSourceSeed',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData,
  });

  // Use HTTP for local development, HTTPS for production
  const isLocal =
    process.env.AWS_ENDPOINT_URL?.includes('localhost') ||
    process.env.AWS_ENDPOINT_URL?.includes('127.0.0.1') ||
    process.env.NODE_ENV === 'development';

  let responseUrl = event.ResponseURL;
  if (isLocal && responseUrl.startsWith('https://')) {
    responseUrl = responseUrl.replace('https://', 'http://');
  }

  try {
    const response = await fetch(responseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length.toString(),
      },
      body: responseBody,
    });

    console.log('Response status code:', response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error('Error sending response:', error);
    throw error;
  }
};

const seedFundingSource = async () => {
  const now = new Date();

  const repository = createRepository();

  const systemAccounts = [
    new Account({
      id: FUNDING_SOURCE.ACCOUNT_ID,
      accountNumber: FUNDING_SOURCE.ACCOUNT_NUMBER,
      name: 'System Funding Source',
      ownerUserId: 'SYSTEM',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: now,
      isTest: false,
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    }),
    new Account({
      id: CARD_SETTLEMENT.ACCOUNT_ID,
      accountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
      name: 'Card Settlement',
      ownerUserId: 'SYSTEM',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: now,
      isTest: false,
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    }),
  ];

  for (const account of systemAccounts) {
    await repository.saveAccount(account);
  }
};

export const handler: CloudFormationCustomResourceHandler = async (
  event,
  context
) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    console.log('seed-funding-source', {
      tableName: process.env.TABLE,
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT_URL,
      requestType: event.RequestType,
    });

    if (event.RequestType.toLowerCase() !== 'delete') {
      await seedFundingSource();

      console.log(
        'Funding source seeded successfully using banking repository'
      );
    } else {
      console.log(`Skipping seed operation for ${event.RequestType} request`);
    }

    await sendResponse(event, context, 'SUCCESS');
  } catch (error) {
    console.error('Error:', error);
    await sendResponse(event, context, 'FAILED');
  }
};
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.AWS_ENDPOINT_URL === LOCALSTACK_ENDPOINT
) {
  // Running under `sam local …` – no CloudFormation present
  seedFundingSource().catch(console.error);
}
