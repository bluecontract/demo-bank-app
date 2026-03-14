#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import {
  BACKEND_BROWSER_URL,
  FALLBACK_AWS_ENDPOINT,
  FRONTEND_BROWSER_URL,
  WORKSPACE_ROOT,
  detectLocalMode,
  getLogFilePath,
  isAwsEndpointReady,
  isBackendHealthy,
  isFrontendHealthy,
  runCommand,
  waitForCondition,
} from './local-runtime.ts';

const PROJECTS_WITH_INTEGRATION_TESTS = [
  '@demo-bank-app/auth',
  '@demo-bank-app/banking',
  '@demo-bank-app/paynotes',
  '@demo-bank-app/bank-api',
];

const getExecutableName = (command: string) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const spawnServeAllDetached = () => {
  const logFile = getLogFilePath('serve-all-detached');
  const fd = openSync(logFile, 'a');
  const child = spawn(
    getExecutableName('npx'),
    ['tsx', 'scripts/serve-all.ts'],
    {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      detached: true,
      stdio: ['ignore', fd, fd],
    }
  );

  child.unref();
  console.log(
    `[verify:full] started detached serve:all manager (log: ${logFile})`
  );
};

const ensureFullStack = async () => {
  const awsReady = await isAwsEndpointReady(FALLBACK_AWS_ENDPOINT);
  const backendReady = await isBackendHealthy();
  const frontendReady = await isFrontendHealthy();

  if (!awsReady || !backendReady || !frontendReady) {
    spawnServeAllDetached();
  } else {
    console.log('[verify:full] reusing existing full local stack');
  }

  await Promise.all([
    waitForCondition({
      name: 'AWS endpoint',
      timeoutMs: 120_000,
      predicate: () => isAwsEndpointReady(FALLBACK_AWS_ENDPOINT),
    }),
    waitForCondition({
      name: 'backend health',
      timeoutMs: 120_000,
      predicate: () => isBackendHealthy(),
    }),
    waitForCondition({
      name: 'frontend health',
      timeoutMs: 120_000,
      predicate: () => isFrontendHealthy(),
    }),
  ]);
};

const installPlaywright = async () => {
  try {
    await runCommand({
      name: 'playwright-install-with-deps',
      command: getExecutableName('npx'),
      args: ['playwright', 'install', '--with-deps', 'chromium'],
    });
  } catch (error) {
    console.warn(
      '[verify:full] playwright install --with-deps failed, retrying without system deps'
    );
    await runCommand({
      name: 'playwright-install',
      command: getExecutableName('npx'),
      args: ['playwright', 'install', 'chromium'],
    });
  }
};

const main = async () => {
  const mode = detectLocalMode();
  console.log(`[verify:full] selected mode: ${mode}`);

  await runCommand({
    name: 'lint-all',
    command: getExecutableName('npm'),
    args: ['run', 'lint:all'],
  });

  await runCommand({
    name: 'typecheck',
    command: getExecutableName('npm'),
    args: ['run', 'typecheck'],
  });

  await runCommand({
    name: 'unit-tests',
    command: getExecutableName('npm'),
    args: ['run', 'test:all'],
  });

  await ensureFullStack();

  for (const project of PROJECTS_WITH_INTEGRATION_TESTS) {
    await runCommand({
      name: `integration-tests-${project.split('/').pop()}`,
      command: getExecutableName('npx'),
      args: ['nx', 'run', `${project}:test:integration:ci`, '--skip-nx-cache'],
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_REGION: 'eu-west-1',
        AWS_DEFAULT_REGION: 'eu-west-1',
        AWS_ENDPOINT_URL: FALLBACK_AWS_ENDPOINT,
      },
    });
  }

  await installPlaywright();

  await runCommand({
    name: 'e2e-tests',
    command: getExecutableName('npm'),
    args: ['run', 'e2e'],
    env: {
      ...process.env,
      E2E_BASE_URL: FRONTEND_BROWSER_URL,
      BANK_API_URL: BACKEND_BROWSER_URL,
    },
  });

  console.log('[verify:full] all verification stages completed successfully');
};

main().catch(error => {
  console.error(
    '[verify:full] failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
