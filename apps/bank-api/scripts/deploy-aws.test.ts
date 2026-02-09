import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const bankApiDir = fileURLToPath(new URL('../', import.meta.url));
const deployScriptPath = fileURLToPath(
  new URL('./deploy-aws.sh', import.meta.url)
);

function readCapturedArgs(captureFile: string): string[] {
  return readFileSync(captureFile, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function extractArgValue(args: string[], key: string): string | null {
  const index = args.indexOf(key);
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }

  return args[index + 1];
}

describe('deploy-aws.sh', () => {
  let fakeBinDir: string;
  let captureArgsFile: string;

  beforeEach(() => {
    fakeBinDir = mkdtempSync(join(tmpdir(), 'demo-bank-sam-bin-'));
    captureArgsFile = join(fakeBinDir, 'sam-args.txt');

    const fakeSamPath = join(fakeBinDir, 'sam');
    writeFileSync(
      fakeSamPath,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "${SAM_ARGS_CAPTURE_FILE:?}"\n',
      'utf8'
    );
    chmodSync(fakeSamPath, 0o755);

    const fakeAwsPath = join(fakeBinDir, 'aws');
    writeFileSync(
      fakeAwsPath,
      `#!/usr/bin/env bash
layer_name=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--layer-name" ]]; then
    next_index=$((i+1))
    layer_name="\${!next_index}"
    break
  fi
done

if [[ "$layer_name" == "Datadog-Node22-x" ]]; then
  echo "222"
  exit 0
fi

if [[ "$layer_name" == "Datadog-Extension" ]]; then
  echo "111"
  exit 0
fi

echo "0"
`,
      'utf8'
    );
    chmodSync(fakeAwsPath, 0o755);
  });

  it('should deploy without Datadog template and without Datadog parameter overrides when disabled', () => {
    const result = spawnSync(deployScriptPath, ['dev'], {
      cwd: bankApiDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        SAM_ARGS_CAPTURE_FILE: captureArgsFile,
        BANK_API_ENABLE_DATADOG: 'false',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    const args = readCapturedArgs(captureArgsFile);
    expect(args).toContain('--config-env');
    expect(args).toContain('dev');
    expect(args).not.toContain('--template-file');

    const configFile = extractArgValue(args, '--config-file');
    expect(configFile).toBeTruthy();

    const renderedSamConfig = readFileSync(configFile!, 'utf8');
    expect(renderedSamConfig).not.toContain('{{DATADOG_PARAMETER_OVERRIDES}}');
    expect(renderedSamConfig).not.toContain('DatadogApiKeySecretArn=');
  });

  it('should inject Datadog parameter overrides and Datadog template when enabled', () => {
    const result = spawnSync(deployScriptPath, ['prod'], {
      cwd: bankApiDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        SAM_ARGS_CAPTURE_FILE: captureArgsFile,
        BANK_API_ENABLE_DATADOG: 'true',
        BANK_API_DATADOG_API_KEY_SECRET_ARN:
          'arn:aws:secretsmanager:eu-west-1:123456789012:secret:datadog-key-abc',
        BANK_API_DD_VERSION: 'abc123',
        BANK_API_DATADOG_SITE: 'datadoghq.eu',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    const args = readCapturedArgs(captureArgsFile);
    expect(args).toContain('--template-file');

    const configFile = extractArgValue(args, '--config-file');
    expect(configFile).toBeTruthy();

    const renderedSamConfig = readFileSync(configFile!, 'utf8');
    expect(renderedSamConfig).toContain(
      'DatadogApiKeySecretArn=arn:aws:secretsmanager:eu-west-1:123456789012:secret:datadog-key-abc'
    );
    expect(renderedSamConfig).toContain('DDVersion=abc123');
    expect(renderedSamConfig).toContain('DatadogSite=datadoghq.eu');
    expect(renderedSamConfig).toContain('DatadogNodeLayerVersion=222');
    expect(renderedSamConfig).toContain('DatadogExtensionLayerVersion=111');
  });

  it('should fail fast when Datadog is enabled without secret arn', () => {
    const result = spawnSync(deployScriptPath, ['dev'], {
      cwd: bankApiDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        SAM_ARGS_CAPTURE_FILE: captureArgsFile,
        BANK_API_ENABLE_DATADOG: 'true',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'BANK_API_DATADOG_API_KEY_SECRET_ARN is required'
    );
  });

  it('should honor explicit Datadog layer version overrides', () => {
    const result = spawnSync(deployScriptPath, ['dev'], {
      cwd: bankApiDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        SAM_ARGS_CAPTURE_FILE: captureArgsFile,
        BANK_API_ENABLE_DATADOG: 'true',
        BANK_API_DATADOG_API_KEY_SECRET_ARN:
          'arn:aws:secretsmanager:eu-west-1:123456789012:secret:datadog-key-abc',
        BANK_API_DATADOG_NODE_LAYER_VERSION: '999',
        BANK_API_DATADOG_EXTENSION_LAYER_VERSION: '888',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    const args = readCapturedArgs(captureArgsFile);
    const configFile = extractArgValue(args, '--config-file');
    expect(configFile).toBeTruthy();

    const renderedSamConfig = readFileSync(configFile!, 'utf8');
    expect(renderedSamConfig).toContain('DatadogNodeLayerVersion=999');
    expect(renderedSamConfig).toContain('DatadogExtensionLayerVersion=888');
  });
});
