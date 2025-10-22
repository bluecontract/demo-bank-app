import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export type MyOsCredentials = {
  apiKey: string;
  accountId: string;
  baseUrl: string;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

export const createMyOsCredentialsResolver = ({
  secretArn,
  secretsClient,
}: {
  secretArn?: string | null;
  secretsClient: SecretsManagerClient;
}) => {
  let cachedCredentials: MyOsCredentials | null = null;

  return async (): Promise<MyOsCredentials> => {
    if (!secretArn) {
      throw new Error('MYOS_SECRET_ARN environment variable is not set.');
    }

    if (cachedCredentials) {
      return cachedCredentials;
    }

    const command = new GetSecretValueCommand({
      SecretId: secretArn,
    });
    const response = await secretsClient.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretArn} does not contain a string value.`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.SecretString);
    } catch (error) {
      throw new Error(
        `Secret ${secretArn} must be valid JSON: ${(error as Error).message}`
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error(
        'MyOS credentials secret must be a JSON object with `apiKey`, `accountId`, and `baseUrl` strings.'
      );
    }

    const { apiKey, accountId, baseUrl } = payload as {
      apiKey?: unknown;
      accountId?: unknown;
      baseUrl?: unknown;
    };

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error(
        'MyOS credentials secret must include a non-empty `apiKey` string.'
      );
    }

    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error(
        'MyOS credentials secret must include a non-empty `accountId` string.'
      );
    }

    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      throw new Error(
        'MyOS credentials secret must include a non-empty `baseUrl` string.'
      );
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl.trim());

    try {
      // Throws if the URL is invalid; ensures we fail fast on bad configuration.
      void new URL(normalizedBaseUrl);
    } catch (error) {
      throw new Error(
        `MyOS credentials secret must include a valid \`baseUrl\`: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    cachedCredentials = {
      apiKey: apiKey.trim(),
      accountId: accountId.trim(),
      baseUrl: normalizedBaseUrl,
    };

    return cachedCredentials;
  };
};
