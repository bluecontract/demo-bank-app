import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export const applyPayNoteIntegrationTestEnv = () => {
  process.env.AWS_REGION ??= 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  process.env.CARD_PROCESSOR_TOKEN ??= 'demo-bank-processor-token';
  process.env.MYOS_SECRET_ARN ??=
    '/demo-bank-app/integration-test/myos-credentials';
  process.env.OPENAI_API_KEY_SECRET_ARN ??=
    '/demo-bank-app/integration-test/openai-api-key';
};

const createSecretsClient = () =>
  new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(process.env.AWS_ENDPOINT_URL
      ? { endpoint: process.env.AWS_ENDPOINT_URL }
      : {}),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });

export async function upsertMyOsCredentialsSecret(input: {
  secretArn: string;
  baseUrl: string;
  apiKey: string;
  accountId: string;
}) {
  const client = createSecretsClient();
  const secretString = JSON.stringify({
    apiKey: input.apiKey,
    accountId: input.accountId,
    baseUrl: input.baseUrl,
  });

  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: input.secretArn,
        SecretString: secretString,
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    await client.send(
      new CreateSecretCommand({
        Name: input.secretArn,
        SecretString: secretString,
      })
    );
  }
}

/**
 * Real OpenAI is not needed for the main PayNote suite when fixtures use
 * LLM_SUMMARY_DISABLED=true. Some local boot paths still expect the secret to
 * exist, so we seed a harmless placeholder using the exact key shape expected
 * by apps/bank-api/src/shared/openAiSecrets.ts.
 */
export async function upsertOpenAiPlaceholderSecret(
  secretArn: string,
  apiKey = 'dummy-not-used'
) {
  const client = createSecretsClient();
  const secretString = JSON.stringify({ openAiApiKey: apiKey });
  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: secretArn,
        SecretString: secretString,
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    await client.send(
      new CreateSecretCommand({
        Name: secretArn,
        SecretString: secretString,
      })
    );
  }
}
