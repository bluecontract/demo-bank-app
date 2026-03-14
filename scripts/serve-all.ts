#!/usr/bin/env tsx

import {
  ensureLocalEnvironment,
  registerSignalCleanup,
} from './local-runtime.ts';

const main = async () => {
  const { mode, started } = await ensureLocalEnvironment({
    includeFrontend: true,
  });

  console.log(
    `[serve:all] environment ready in ${mode} mode; press Ctrl+C to stop processes started by this command`
  );

  if (started.length === 0) {
    console.log('[serve:all] all services were already running');
  }

  registerSignalCleanup(started);

  await new Promise(() => {
    /* keep process alive while child services run */
  });
};

main().catch(error => {
  console.error(
    '[serve:all] failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
