export const SAFE_TEST_AMOUNT_CAP_MINOR = 100_000;

export const FAST_AMOUNTS = {
  cardPurchaseMinor: 1_200,
  transferMinor: 1_800,
  pendingInstallMinor: 2_200,
  voucherReserveMinor: 1_000,
  scaledMilestoneCapturesMinor: [8_000, 12_000, 7_000, 9_000] as const,
  subscriptionMonthlyMinor: 1_200,
  refrigeratorPurchaseMinor: 12_000,
  fundingBufferMinor: 25_000,
};

export function sumMinor(values: readonly number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

export function assertSafeTestAmount(
  amountMinor: number,
  label = 'amountMinor'
) {
  if (!(amountMinor > 0)) {
    throw new Error(`${label} must be > 0`);
  }
  if (amountMinor >= SAFE_TEST_AMOUNT_CAP_MINOR) {
    throw new Error(
      `${label} must stay below ${SAFE_TEST_AMOUNT_CAP_MINOR} for integration tests`
    );
  }
  return amountMinor;
}
