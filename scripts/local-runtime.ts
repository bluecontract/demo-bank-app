import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  type WriteStream,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CreateSecretCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const WORKSPACE_ROOT = join(__dirname, '..');
export const LOGS_DIR = join(WORKSPACE_ROOT, 'tmp', 'environment-verification');
export const TOOLING_DIR = join(WORKSPACE_ROOT, 'tmp', 'sandbox-tools');
export const PYTHON_VENV_DIR = join(TOOLING_DIR, 'moto-venv');
export const MOTO_SERVER_BIN = join(PYTHON_VENV_DIR, 'bin', 'moto_server');
export const USER_SITE_BIN = join(
  process.env.HOME ?? '/tmp',
  '.local',
  'bin',
  'moto_server'
);
export const FALLBACK_AWS_ENDPOINT = 'http://127.0.0.1:4566';
export const FRONTEND_URL = 'http://localhost:4200';
export const BACKEND_URL = 'http://127.0.0.1:3000';
export const FRONTEND_BROWSER_URL = 'http://localhost:4200';
export const BACKEND_BROWSER_URL = 'http://localhost:3000';

export const LOCAL_RESOURCE_CONFIG = {
  tableName: 'demo-bank-dev',
  jwtSecretArn: '/demo-bank-app/dev/auth-jwt-secret',
  openAiSecretArn: '/demo-bank-app/dev/openai-api-key',
  myOsSecretArn: '/demo-bank-app/dev/myos-credentials',
} as const;

export type LocalMode = 'native' | 'fallback';

export type ManagedProcess = {
  name: string;
  child: ChildProcess;
  logFile: string;
};

const DEFAULT_AWS_CONFIG = {
  region: 'eu-west-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
};

const FALLBACK_RUNTIME_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'eu-west-1',
  AWS_DEFAULT_REGION: 'eu-west-1',
  AWS_ENDPOINT_URL: FALLBACK_AWS_ENDPOINT,
  AUTH_DYNAMO_TABLE_NAME: LOCAL_RESOURCE_CONFIG.tableName,
  BANKING_DYNAMO_TABLE_NAME: LOCAL_RESOURCE_CONFIG.tableName,
  JWT_SECRET_ARN: LOCAL_RESOURCE_CONFIG.jwtSecretArn,
  OPENAI_API_KEY_SECRET_ARN: LOCAL_RESOURCE_CONFIG.openAiSecretArn,
  MYOS_SECRET_ARN: LOCAL_RESOURCE_CONFIG.myOsSecretArn,
  MYOS_API_KEY: '',
  MYOS_ACCOUNT_ID: '',
  MYOS_BASE_URL: '',
  JWT_TTL_SECONDS: '604800',
  TEST_USER_TTL_SECONDS: '600',
  SERVICE_NAME: 'bank-api-dev',
  LOG_LEVEL: 'INFO',
  METRICS_NAMESPACE: 'DemoBlue/dev',
  CARD_PAN_SECRET: 'demo-bank-pan-secret',
  CARD_CVC_SECRET: 'demo-bank-cvc-secret',
  CARD_PROCESSOR_TOKEN: 'demo-bank-processor-token',
  CARD_BIN_PREFIX: '123456',
  CARD_SETTLEMENT_ACCOUNT_ID: 'CARD_SETTLEMENT',
  CARD_SETTLEMENT_ACCOUNT_NUMBER: '9999999999',
} as const;

export const getFallbackRuntimeEnv = () => ({
  ...process.env,
  ...FALLBACK_RUNTIME_ENV,
});

const getExecutableName = (command: string) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const commandExists = (command: string): boolean =>
  spawnSync('bash', ['-lc', `command -v ${command}`], {
    cwd: WORKSPACE_ROOT,
    stdio: 'ignore',
  }).status === 0;

export const detectLocalMode = (): LocalMode =>
  commandExists('docker') && commandExists('sam') && commandExists('samlocal')
    ? 'native'
    : 'fallback';

export const ensureDirectory = (directory: string) => {
  mkdirSync(directory, { recursive: true });
};

export const getLogFilePath = (name: string) => {
  ensureDirectory(LOGS_DIR);
  return join(LOGS_DIR, `${name}.log`);
};

const openLogStream = (logFile: string): WriteStream => {
  ensureDirectory(dirname(logFile));
  const stream = createWriteStream(logFile, { flags: 'a' });
  stream.write(`\n===== ${new Date().toISOString()} :: new session =====\n`);
  return stream;
};

const pipeOutput = (
  child: ChildProcess,
  stream: WriteStream,
  prefix: string,
  mirrorToConsole = true
) => {
  child.stdout?.on('data', chunk => {
    const text = chunk.toString();
    stream.write(text);
    if (mirrorToConsole) {
      process.stdout.write(`[${prefix}] ${text}`);
    }
  });

  child.stderr?.on('data', chunk => {
    const text = chunk.toString();
    stream.write(text);
    if (mirrorToConsole) {
      process.stderr.write(`[${prefix}] ${text}`);
    }
  });

  child.on('exit', code => {
    const message = `[${prefix}] exited with code ${code ?? 'null'}\n`;
    stream.write(message);
    if (mirrorToConsole) {
      process.stdout.write(message);
    }
  });
};

export const runCommand = async ({
  name,
  command,
  args,
  cwd = WORKSPACE_ROOT,
  env,
  logFile = getLogFilePath(`${name}-command`),
  mirrorToConsole = true,
}: {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logFile?: string;
  mirrorToConsole?: boolean;
}) => {
  const stream = openLogStream(logFile);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pipeOutput(child, stream, name, mirrorToConsole);

    child.on('error', error => {
      stream.end();
      reject(error);
    });

    child.on('exit', code => {
      stream.end();
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${name} failed with exit code ${code ?? 'null'} (see ${logFile})`
        )
      );
    });
  });
};

export const spawnManagedProcess = ({
  name,
  command,
  args,
  cwd = WORKSPACE_ROOT,
  env,
  logFile = getLogFilePath(name),
  mirrorToConsole = true,
}: {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logFile?: string;
  mirrorToConsole?: boolean;
}): ManagedProcess => {
  const stream = openLogStream(logFile);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeOutput(child, stream, name, mirrorToConsole);
  child.on('error', error => {
    stream.write(`[${name}] process error: ${String(error)}\n`);
  });

  return {
    name,
    child,
    logFile,
  };
};

export const terminateManagedProcesses = async (
  processes: ManagedProcess[]
): Promise<void> => {
  await Promise.all(
    processes.map(
      processInfo =>
        new Promise<void>(resolve => {
          const { child } = processInfo;

          if (child.killed || child.exitCode !== null) {
            resolve();
            return;
          }

          child.once('exit', () => resolve());
          child.kill('SIGTERM');

          setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 5_000).unref();
        })
    )
  );
};

const wait = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

export const waitForCondition = async ({
  name,
  timeoutMs,
  intervalMs = 1_000,
  predicate,
}: {
  name: string;
  timeoutMs: number;
  intervalMs?: number;
  predicate: () => Promise<boolean>;
}) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await wait(intervalMs);
  }

  throw new Error(`${name} did not become ready within ${timeoutMs}ms`);
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
};

export const isBackendHealthy = async (): Promise<boolean> => {
  try {
    const data = await fetchJson(`${BACKEND_URL}/health`);
    return Boolean(data && data.status === 'healthy');
  } catch {
    return false;
  }
};

export const isFrontendHealthy = async (): Promise<boolean> => {
  try {
    const response = await fetch(FRONTEND_URL, {
      headers: { Accept: 'text/html' },
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const isAwsEndpointReady = async (
  endpoint = FALLBACK_AWS_ENDPOINT
): Promise<boolean> => {
  try {
    const dynamo = new DynamoDBClient({
      ...DEFAULT_AWS_CONFIG,
      endpoint,
    });
    const secrets = new SecretsManagerClient({
      ...DEFAULT_AWS_CONFIG,
      endpoint,
    });

    await Promise.all([
      dynamo.send(new ListTablesCommand({ Limit: 1 })),
      secrets.send(new ListSecretsCommand({ MaxResults: 1 })),
    ]);

    return true;
  } catch {
    return false;
  }
};

export const ensureMotoServerInstalled = async () => {
  ensureDirectory(TOOLING_DIR);

  if (existsSync(MOTO_SERVER_BIN)) {
    return MOTO_SERVER_BIN;
  }

  if (existsSync(USER_SITE_BIN)) {
    return USER_SITE_BIN;
  }

  const python = getExecutableName('python3');
  const venvPython = join(PYTHON_VENV_DIR, 'bin', 'python');

  try {
    await runCommand({
      name: 'python-venv-create',
      command: python,
      args: ['-m', 'venv', PYTHON_VENV_DIR],
      mirrorToConsole: false,
    });

    await runCommand({
      name: 'python-pip-upgrade',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'pip'],
    });

    await runCommand({
      name: 'python-install-moto',
      command: venvPython,
      args: ['-m', 'pip', 'install', 'moto[server]'],
    });

    return MOTO_SERVER_BIN;
  } catch (error) {
    await runCommand({
      name: 'python-install-moto-user',
      command: python,
      args: ['-m', 'pip', 'install', '--user', 'moto[server]'],
    });

    if (existsSync(USER_SITE_BIN)) {
      return USER_SITE_BIN;
    }

    throw error;
  }
};

const createFallbackClients = (endpoint = FALLBACK_AWS_ENDPOINT) => ({
  dynamo: new DynamoDBClient({
    ...DEFAULT_AWS_CONFIG,
    endpoint,
  }),
  secrets: new SecretsManagerClient({
    ...DEFAULT_AWS_CONFIG,
    endpoint,
  }),
});

export const provisionFallbackResources = async (
  endpoint = FALLBACK_AWS_ENDPOINT
) => {
  const { dynamo, secrets } = createFallbackClients(endpoint);

  try {
    await dynamo.send(
      new DescribeTableCommand({
        TableName: LOCAL_RESOURCE_CONFIG.tableName,
      })
    );
  } catch (error) {
    const errorName = (error as { name?: string }).name;

    if (errorName !== 'ResourceNotFoundException') {
      throw error;
    }

    await dynamo.send(
      new CreateTableCommand({
        TableName: LOCAL_RESOURCE_CONFIG.tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'AUTH_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'AUTH_GSI1SK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI1SK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI2PK', AttributeType: 'S' },
          { AttributeName: 'BANKING_GSI2SK', AttributeType: 'S' },
          { AttributeName: 'HOLD_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'HOLD_GSI1SK', AttributeType: 'S' },
          { AttributeName: 'HOLD_EVENT_GSI1PK', AttributeType: 'S' },
          { AttributeName: 'HOLD_EVENT_GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'AUTH_GSI1',
            KeySchema: [
              { AttributeName: 'AUTH_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'AUTH_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'BANKING_GSI1',
            KeySchema: [
              { AttributeName: 'BANKING_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'BANKING_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'BANKING_GSI2',
            KeySchema: [
              { AttributeName: 'BANKING_GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'BANKING_GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'HOLD_GSI1',
            KeySchema: [
              { AttributeName: 'HOLD_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'HOLD_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'HOLD_EVENT_GSI1',
            KeySchema: [
              { AttributeName: 'HOLD_EVENT_GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'HOLD_EVENT_GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
  }

  await waitForCondition({
    name: 'fallback dynamodb table',
    timeoutMs: 30_000,
    predicate: async () => {
      try {
        const result = await dynamo.send(
          new DescribeTableCommand({
            TableName: LOCAL_RESOURCE_CONFIG.tableName,
          })
        );
        return result.Table?.TableStatus === 'ACTIVE';
      } catch {
        return false;
      }
    },
  });

  const ensureSecret = async (name: string, secretString: string) => {
    try {
      await secrets.send(
        new CreateSecretCommand({
          Name: name,
          SecretString: secretString,
        })
      );
    } catch (error) {
      const errorName = (error as { name?: string }).name;
      if (errorName !== 'ResourceExistsException') {
        throw error;
      }
    }
  };

  await Promise.all([
    ensureSecret(
      LOCAL_RESOURCE_CONFIG.jwtSecretArn,
      JSON.stringify({ secret: 'local-demo-jwt-secret' })
    ),
    ensureSecret(
      LOCAL_RESOURCE_CONFIG.openAiSecretArn,
      JSON.stringify({ openAiApiKey: '' })
    ),
    ensureSecret(
      LOCAL_RESOURCE_CONFIG.myOsSecretArn,
      JSON.stringify({ apiKey: '', accountId: '', baseUrl: '' })
    ),
  ]);
};

const spawnNx = (
  name: string,
  args: string[],
  options: Omit<
    Parameters<typeof spawnManagedProcess>[0],
    'name' | 'command' | 'args'
  > = {}
) =>
  spawnManagedProcess({
    name,
    command: getExecutableName('npx'),
    args,
    ...options,
  });

export const startFallbackAwsEmulator = async () => {
  const motoServerBin = await ensureMotoServerInstalled();
  return spawnManagedProcess({
    name: 'aws-emulator',
    command: motoServerBin,
    args: ['-H', '127.0.0.1', '-p', '4566'],
  });
};

export const startFallbackBackend = async () =>
  spawnNx('bank-api-local', ['tsx', 'scripts/start-bank-api-local.ts'], {
    env: getFallbackRuntimeEnv(),
  });

export const startFrontend = async () =>
  spawnNx('bank-web-app', ['nx', 'run', '@demo-bank-app/bank-web-app:serve'], {
    env: {
      ...process.env,
      BANK_API_URL: BACKEND_BROWSER_URL,
    },
  });

export const startNativeBackend = async () =>
  spawnNx('bank-api-native', ['nx', 'run', '@demo-bank-app/bank-api:serve']);

export const ensureLocalEnvironment = async ({
  includeFrontend,
}: {
  includeFrontend: boolean;
}) => {
  ensureDirectory(LOGS_DIR);
  const mode = detectLocalMode();
  const started: ManagedProcess[] = [];

  console.log(`[local-runtime] selected mode: ${mode}`);
  console.log(`[local-runtime] logs directory: ${LOGS_DIR}`);

  if (mode === 'fallback') {
    if (!(await isAwsEndpointReady())) {
      console.log('[local-runtime] starting fallback AWS emulator');
      started.push(await startFallbackAwsEmulator());
      await waitForCondition({
        name: 'fallback aws emulator',
        timeoutMs: 90_000,
        predicate: () => isAwsEndpointReady(),
      });
    } else {
      console.log('[local-runtime] reusing existing AWS emulator');
    }

    await provisionFallbackResources();

    if (!(await isBackendHealthy())) {
      console.log('[local-runtime] starting fallback backend bridge');
      started.push(await startFallbackBackend());
      await waitForCondition({
        name: 'fallback backend',
        timeoutMs: 90_000,
        predicate: () => isBackendHealthy(),
      });
    } else {
      console.log('[local-runtime] reusing existing backend');
    }
  } else if (!(await isBackendHealthy())) {
    console.log('[local-runtime] starting native bank-api target');
    started.push(await startNativeBackend());
    await waitForCondition({
      name: 'native backend',
      timeoutMs: 180_000,
      predicate: () => isBackendHealthy(),
    });
  } else {
    console.log('[local-runtime] reusing existing backend');
  }

  if (includeFrontend) {
    if (!(await isFrontendHealthy())) {
      console.log('[local-runtime] starting frontend');
      started.push(await startFrontend());
      await waitForCondition({
        name: 'frontend',
        timeoutMs: 90_000,
        predicate: () => isFrontendHealthy(),
      });
    } else {
      console.log('[local-runtime] reusing existing frontend');
    }
  }

  return {
    mode,
    started,
  };
};

export const registerSignalCleanup = (processes: ManagedProcess[]) => {
  const cleanup = async () => {
    await terminateManagedProcesses(processes);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void cleanup();
  });
  process.once('SIGTERM', () => {
    void cleanup();
  });
};
