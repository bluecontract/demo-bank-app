import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export const createOpenAiApiKeyResolver = ({
  secretArn,
  secretsClient,
}: {
  secretArn?: string | null;
  secretsClient: SecretsManagerClient;
}) => {
  let cachedApiKey: string | null = null;

  return async (): Promise<string> => {
    if (!secretArn) {
      throw new Error(
        'OPENAI_API_KEY_SECRET_ARN environment variable is not set.'
      );
    }

    if (cachedApiKey) {
      return cachedApiKey;
    }

    const command = new GetSecretValueCommand({
      SecretId: secretArn,
    });

    const response = await secretsClient.send(command);
    if (!response.SecretString) {
      throw new Error(`Secret ${secretArn} does not contain a string value.`);
    }

    let apiKey = response.SecretString;

    const parsed = JSON.parse(response.SecretString) as unknown;
    if (typeof parsed === 'string') {
      apiKey = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const maybeKey = (parsed as { openAiApiKey?: unknown }).openAiApiKey;
      if (typeof maybeKey === 'string') {
        apiKey = maybeKey;
      } else {
        throw new Error(
          'API key not found in JSON secret. Expected property `openAiApiKey`.'
        );
      }
    }

    cachedApiKey = apiKey;
    return apiKey;
  };
};
