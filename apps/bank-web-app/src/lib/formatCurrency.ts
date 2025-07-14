export function formatCurrency(amountMinor: number): string {
  const isNegative = amountMinor < 0;
  const absAmount = Math.abs(amountMinor);

  // Convert from minor units (cents) to dollars
  const dollars = absAmount / 100;

  // Check if we have cents
  const hasCents = absAmount % 100 !== 0;

  // Format with appropriate decimal places
  const formattedAmount = hasCents ? dollars.toFixed(2) : dollars.toFixed(0);

  // Add comma separators for thousands
  const parts = formattedAmount.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const finalAmount = parts.join('.');

  // Add currency symbol and handle negative sign
  return isNegative ? `-$${finalAmount}` : `$${finalAmount}`;
}
