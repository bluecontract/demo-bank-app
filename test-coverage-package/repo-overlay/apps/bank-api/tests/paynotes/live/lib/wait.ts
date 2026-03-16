import waitForExpect from 'wait-for-expect';

export async function waitForExpectWithLogging(
  expectFn: () => Promise<void> | void,
  totalTimeMs: number,
  intervalMs: number,
  label = 'wait'
) {
  let attempt = 0;
  const wrapped = async () => {
    attempt += 1;
    const elapsedMs = attempt * intervalMs;
    const remainingMs = Math.max(totalTimeMs - elapsedMs, 0);
    console.log(
      `[${label}] attempt=${attempt} remaining=${Math.round(
        remainingMs / 1000
      )}s`
    );
    await expectFn();
  };

  await waitForExpect(wrapped, totalTimeMs, intervalMs);
}

export const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
