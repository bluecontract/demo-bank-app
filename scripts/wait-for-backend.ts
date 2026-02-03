#!/usr/bin/env tsx

/**
 * Health check script that waits for the backend to become responsive
 * before proceeding with E2E tests.
 */

const BANK_API_URL = process.env.BANK_API_URL || 'http://localhost:3000';
const HEALTH_ENDPOINT = `${BANK_API_URL}/health`;
const DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 10000, 20000, 30000, 60000];
const HEALTHCHECK_TIMEOUT_MS = Number(
  process.env.HEALTHCHECK_TIMEOUT_MS ?? 5000
);

const parseDelays = (raw?: string) => {
  if (!raw) {
    return null;
  }
  const values = raw
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => value * 1000);

  return values.length > 0 ? values : null;
};

const RETRY_DELAYS_MS =
  parseDelays(process.env.BACKEND_HEALTHCHECK_DELAYS) ??
  DEFAULT_RETRY_DELAYS_MS;

async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      HEALTHCHECK_TIMEOUT_MS
    );

    const response = await fetch(HEALTH_ENDPOINT, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return data.status === 'healthy';
    }

    return false;
  } catch (error) {
    // Network errors, timeouts, etc.
    return false;
  }
}

async function waitForBackend(): Promise<void> {
  console.log(`🔍 Checking backend health at ${HEALTH_ENDPOINT}...`);

  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isHealthy = await checkHealth();

    if (isHealthy) {
      console.log(`✅ Backend is healthy and ready for E2E tests!`);
      return;
    }

    if (attempt === maxAttempts) {
      console.error(
        `❌ Backend failed to become healthy after ${maxAttempts} attempts.`
      );
      console.error(`\n💡 Make sure the backend is running:`);
      console.error(`   npm run serve:stack`);
      console.error(`\n🔗 Health endpoint: ${HEALTH_ENDPOINT}`);
      process.exit(1);
    }

    const delay = RETRY_DELAYS_MS[attempt - 1];

    console.log(
      `⏳ Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Check if this script is being run directly (ES module equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  waitForBackend().catch(error => {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  });
}
