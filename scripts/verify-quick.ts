#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const NO_TEST_PATTERNS = [
  /No projects with target .* were run/i,
  /No tasks were run/i,
  /No projects were run/i,
];

const buildEnv = () => ({
  ...process.env,
  NX_DAEMON: process.env.NX_DAEMON ?? 'false',
});

type CommandResult = {
  code: number | null;
  output: string;
};

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: buildEnv(),
    });

    let output = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', code => {
      resolve({ code, output });
    });
  });
}

async function runOrExit(
  command: string,
  args: string[]
): Promise<CommandResult> {
  const result = await runCommand(command, args);
  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
  return result;
}

async function main(): Promise<void> {
  await runOrExit(npmCommand, ['run', 'deps:blue:check']);
  await runOrExit(npmCommand, ['run', 'lint']);
  await runOrExit(npmCommand, ['run', 'typecheck']);
  await runOrExit(npmCommand, ['run', 'build:all']);

  const testResult = await runOrExit(npmCommand, ['run', 'test']);
  const noTests = NO_TEST_PATTERNS.some(pattern =>
    pattern.test(testResult.output)
  );

  if (noTests) {
    console.log('INFO: No affected tests detected; running full test suite.');
    await runOrExit(npmCommand, ['run', 'test:all']);
  }
}

main().catch(error => {
  console.error('ERROR: Quick verify failed:', error);
  process.exit(1);
});
