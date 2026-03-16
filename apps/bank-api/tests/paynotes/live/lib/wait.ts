export async function waitForExpectWithLogging(
  expectFn: () => Promise<void> | void,
  totalTimeMs: number,
  intervalMs: number,
  label = 'wait'
) {
  const deadlineAt = Date.now() + totalTimeMs;
  let attempt = 0;
  let lastError: unknown;

  while (Date.now() <= deadlineAt) {
    attempt += 1;
    const remainingMs = Math.max(deadlineAt - Date.now(), 0);
    console.log(
      `[${label}] attempt=${attempt} remaining=${Math.round(
        remainingMs / 1000
      )}s`
    );

    try {
      await expectFn();
      return;
    } catch (error) {
      lastError = error;
    }

    if (Date.now() + intervalMs > deadlineAt) {
      break;
    }

    await sleep(intervalMs);
  }

  throw (
    lastError ??
    new Error(`Timed out waiting for "${label}" after ${totalTimeMs}ms`)
  );
}

export const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
