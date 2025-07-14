export function formatAccountNumber(accountNumber: string): string {
  if (!accountNumber) return '';

  // Remove any existing formatting (spaces, hyphens, etc.)
  const cleaned = accountNumber.replace(/\D/g, '');

  // If account number is too short, return as is
  if (cleaned.length <= 6) {
    return cleaned;
  }

  // Format based on length
  if (cleaned.length <= 10) {
    // Format as XXX XXX XXXX
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
  } else if (cleaned.length <= 12) {
    // Format as XXX XXX XXX XXX
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
  } else {
    // For longer numbers, just group by 3s
    return cleaned.replace(/(\d{3})(?=\d)/g, '$1 ');
  }
}
