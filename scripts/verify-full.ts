#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

type CommandResult = {
  code: number | null;
};

const buildEnv = () => ({
  ...process.env,
  NX_DAEMON: process.env.NX_DAEMON ?? 'false',
});

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: buildEnv(),
    });

    child.on('close', code => {
      resolve({ code });
    });
  });
}

async function runOrExit(command: string, args: string[]): Promise<void> {
  const result = await runCommand(command, args);
  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
}

async function main(): Promise<void> {
  await runOrExit(npxCommand, [
    'nx',
    'run',
    '@demo-bank-app/bank-web-app:build',
  ]);
  await runOrExit(npmCommand, ['run', 'lint']);
  await runOrExit(npmCommand, ['run', 'typecheck']);
  await runOrExit(npmCommand, ['run', 'build:all']);
  await runOrExit(npmCommand, ['run', 'test:all']);
  await runOrExit(npmCommand, ['run', 'test:integration:all']);
  await runOrExit(npmCommand, ['run', 'e2e']);
}

main().catch(error => {
  console.error('ERROR: Full verify failed:', error);
  process.exit(1);
});
