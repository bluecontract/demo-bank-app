#!/usr/bin/env tsx

/**
 * Health check script that waits for the backend to become responsive
 * before proceeding with E2E tests.
 */

const BANK_API_URL = process.env.BANK_API_URL || 'http://localhost:3000';
const HEALTH_ENDPOINT = `${BANK_API_URL}/health`;
const MAX_ATTEMPTS = 5; // 5 attempts
const INITIAL_DELAY = 1000; // Start with 1 second
const MAX_DELAY = 5000; // Cap at 5 seconds

async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isHealthy = await checkHealth();

    if (isHealthy) {
      console.log(`✅ Backend is healthy and ready for E2E tests!`);
      return;
    }

    if (attempt === MAX_ATTEMPTS) {
      console.error(
        `❌ Backend failed to become healthy after ${MAX_ATTEMPTS} attempts.`
      );
      console.error(`\n💡 Make sure the backend is running:`);
      console.error(`   npm run serve:stack`);
      console.error(`\n🔗 Health endpoint: ${HEALTH_ENDPOINT}`);
      process.exit(1);
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      INITIAL_DELAY * Math.pow(1.5, attempt - 1),
      MAX_DELAY
    );
    const jitter = Math.random() * 500; // Add up to 500ms jitter
    const totalDelay = Math.floor(delay + jitter);

    console.log(
      `⏳ Attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${totalDelay}ms...`
    );
    await new Promise(resolve => setTimeout(resolve, totalDelay));
  }
}

// Check if this script is being run directly (ES module equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  waitForBackend().catch(error => {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  });
}
