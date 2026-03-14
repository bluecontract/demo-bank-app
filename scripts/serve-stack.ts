#!/usr/bin/env tsx

import {
  ensureLocalEnvironment,
  registerSignalCleanup,
} from './local-runtime.ts';

const main = async () => {
  const { mode, started } = await ensureLocalEnvironment({
    includeFrontend: false,
  });

  console.log(
    `[serve:stack] backend stack ready in ${mode} mode; press Ctrl+C to stop processes started by this command`
  );

  if (started.length === 0) {
    console.log('[serve:stack] backend stack was already running');
  }

  registerSignalCleanup(started);

  await new Promise(() => {
    /* keep process alive while child services run */
  });
};

main().catch(error => {
  console.error(
    '[serve:stack] failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
