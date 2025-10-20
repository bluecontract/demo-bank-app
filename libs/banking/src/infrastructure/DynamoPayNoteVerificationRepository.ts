import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';

const ENTITY_TYPE = 'PAYNOTE_VERIFICATION';

const TABLE_PREFIXES = {
  USER: 'USER#',
  PAYNOTE_VERIFICATION: 'PAYNOTE_VERIFICATION#',
} as const;

export interface PayNoteVerificationRecord {
  userId: string;
  blueId: string;
  validationScore: number;
  explanation: string;
  isSuccessful: boolean;
  validatedAt: string;
  ttl?: number;
}

export interface SavePayNoteVerificationInput {
  userId: string;
  blueId: string;
  validationScore: number;
  explanation: string;
  isSuccessful: boolean;
  validatedAt: string;
  ttl?: number;
}

type DynamoPayNoteVerificationRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

export interface PayNoteVerificationRepository {
  saveVerification(input: SavePayNoteVerificationInput): Promise<void>;
  getVerification(params: {
    userId: string;
    blueId: string;
  }): Promise<PayNoteVerificationRecord | null>;
}

export class DynamoPayNoteVerificationRepository
  implements PayNoteVerificationRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoPayNoteVerificationRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();

    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildPk(userId: string) {
    return `${TABLE_PREFIXES.USER}${userId}`;
  }

  private buildSk(blueId: string) {
    return `${TABLE_PREFIXES.PAYNOTE_VERIFICATION}${blueId}`;
  }

  async saveVerification({
    userId,
    blueId,
    validationScore,
    explanation,
    isSuccessful,
    validatedAt,
    ttl,
  }: SavePayNoteVerificationInput): Promise<void> {
    const item: Record<string, unknown> = {
      PK: this.buildPk(userId),
      SK: this.buildSk(blueId),
      entityType: ENTITY_TYPE,
      userId,
      blueId,
      validationScore,
      explanation,
      isSuccessful,
      validatedAt,
      updatedAt: validatedAt,
    };

    if (typeof ttl === 'number') {
      item.ttl = ttl;
    }

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async getVerification({
    userId,
    blueId,
  }: {
    userId: string;
    blueId: string;
  }): Promise<PayNoteVerificationRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPk(userId),
          SK: this.buildSk(blueId),
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { validationScore, explanation, isSuccessful, validatedAt, ttl } =
      response.Item as {
        validationScore: number;
        explanation: string;
        isSuccessful: boolean;
        validatedAt: string;
        ttl?: number;
      };

    return {
      userId,
      blueId,
      validationScore,
      explanation,
      isSuccessful,
      validatedAt,
      ttl,
    };
  }
}
