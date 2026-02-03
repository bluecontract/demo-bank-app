import fs from 'node:fs';
import path from 'node:path';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

type EnvFile = {
  Parameters?: Record<string, string>;
};

type EnvParams = Record<string, string | undefined>;

const DEFAULTS = {
  awsRegion: 'eu-west-1',
  awsEndpoint: 'http://localhost:4566',
  awsAccessKeyId: 'test',
  awsSecretAccessKey: 'test',
  jwtSecret: 'local-dev-jwt-secret',
  openAiApiKey: 'local-openai-key',
  myOsApiKey: 'local-myos-api-key',
  myOsAccountId: 'local-myos-account-id',
  myOsBaseUrl: 'http://localhost:3000',
};

const readEnvFile = (filePath: string): EnvParams => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as EnvFile;
  return parsed.Parameters ?? {};
};

const normalizeEndpoint = (endpoint?: string): string | undefined => {
  if (!endpoint) return endpoint;
  try {
    const url = new URL(endpoint);
    if (url.hostname === 'host.docker.internal') {
      url.hostname = 'localhost';
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    return endpoint;
  }
  return endpoint;
};

const getEnvParams = (): EnvParams => {
  const envFilePath = process.env.ENV_VARS_FILE
    ? path.resolve(process.env.ENV_VARS_FILE)
    : path.resolve(process.cwd(), 'env.local.json');

  const fileParams = readEnvFile(envFilePath);

  return {
    ...fileParams,
    ...process.env,
  };
};

const createSecretIfMissing = async (
  client: SecretsManagerClient,
  name: string,
  payload: string,
  description: string
) => {
  try {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: payload,
        Description: description,
      })
    );
    console.info(`Created secret: ${name}`);
  } catch (error) {
    if (error instanceof ResourceExistsException) {
      console.info(`Secret already exists: ${name}`);
      return;
    }
    throw error;
  }
};

const extractOpenAiApiKey = (secretString: string | undefined): string => {
  if (!secretString) {
    return '';
  }

  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (typeof parsed === 'string') {
      return parsed.trim();
    }
    if (parsed && typeof parsed === 'object') {
      const maybeKey = (parsed as { openAiApiKey?: unknown }).openAiApiKey;
      return typeof maybeKey === 'string' ? maybeKey.trim() : '';
    }
  } catch {
    return secretString.trim();
  }

  return '';
};

const run = async () => {
  const params = getEnvParams();

  const jwtSecretArn = params.JWT_SECRET_ARN?.trim();
  const openAiSecretArn = params.OPENAI_API_KEY_SECRET_ARN?.trim();
  const myOsSecretArn = params.MYOS_SECRET_ARN?.trim();

  const awsRegion = params.AWS_REGION?.trim() || DEFAULTS.awsRegion;
  const endpoint = normalizeEndpoint(
    params.AWS_ENDPOINT_URL?.trim() || DEFAULTS.awsEndpoint
  );
  const accessKeyId =
    params.AWS_ACCESS_KEY_ID?.trim() || DEFAULTS.awsAccessKeyId;
  const secretAccessKey =
    params.AWS_SECRET_ACCESS_KEY?.trim() || DEFAULTS.awsSecretAccessKey;

  const client = new SecretsManagerClient({
    region: awsRegion,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  if (jwtSecretArn) {
    const jwtSecret = params.JWT_SECRET_VALUE?.trim() || DEFAULTS.jwtSecret;
    await createSecretIfMissing(
      client,
      jwtSecretArn,
      JSON.stringify({ secret: jwtSecret }),
      'JWT secret for local development'
    );
  } else {
    console.warn('JWT_SECRET_ARN not set; skipping JWT secret creation.');
  }

  if (openAiSecretArn) {
    const explicitOpenAiKey = params.OPENAI_API_KEY?.trim();
    const openAiApiKey = explicitOpenAiKey || DEFAULTS.openAiApiKey;
    const payload = JSON.stringify({ openAiApiKey });

    try {
      await client.send(
        new CreateSecretCommand({
          Name: openAiSecretArn,
          SecretString: payload,
          Description: 'OpenAI API key for local development',
        })
      );
      console.info(`Created secret: ${openAiSecretArn}`);
    } catch (error) {
      if (!(error instanceof ResourceExistsException)) {
        throw error;
      }

      const existing = await client.send(
        new GetSecretValueCommand({ SecretId: openAiSecretArn })
      );
      const existingKey = extractOpenAiApiKey(existing.SecretString);
      const shouldUpdate = explicitOpenAiKey
        ? existingKey !== explicitOpenAiKey
        : existingKey.length === 0;

      if (shouldUpdate) {
        await client.send(
          new PutSecretValueCommand({
            SecretId: openAiSecretArn,
            SecretString: payload,
          })
        );
        console.info(`Updated secret: ${openAiSecretArn}`);
      } else {
        console.info(`Secret already exists: ${openAiSecretArn}`);
      }
    }
  } else {
    console.warn(
      'OPENAI_API_KEY_SECRET_ARN not set; skipping OpenAI secret creation.'
    );
  }

  if (myOsSecretArn) {
    const apiKey = params.MYOS_API_KEY?.trim() || DEFAULTS.myOsApiKey;
    const accountId = params.MYOS_ACCOUNT_ID?.trim() || DEFAULTS.myOsAccountId;
    const baseUrl = params.MYOS_BASE_URL?.trim() || DEFAULTS.myOsBaseUrl;

    await createSecretIfMissing(
      client,
      myOsSecretArn,
      JSON.stringify({ apiKey, accountId, baseUrl }),
      'MyOS credentials for local development'
    );
  } else {
    console.warn('MYOS_SECRET_ARN not set; skipping MyOS secret creation.');
  }
};

run().catch(error => {
  console.error('Failed to seed local secrets:', error);
  process.exitCode = 1;
});
