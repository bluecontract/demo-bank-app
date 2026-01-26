const DEFAULT_BIN_PREFIX = '123456';
const PAN_LENGTH = 16;

export const CARD_UTILS_CONSTANTS = {
  DEFAULT_BIN_PREFIX,
  PAN_LENGTH,
} as const;

export function generatePan(
  binPrefix = DEFAULT_BIN_PREFIX,
  randomDigit: () => number = () => Math.floor(Math.random() * 10)
): string {
  if (!/^\d+$/.test(binPrefix)) {
    throw new Error('BIN prefix must be numeric');
  }

  const bodyLength = PAN_LENGTH - binPrefix.length - 1;
  if (bodyLength <= 0) {
    throw new Error('BIN prefix too long for PAN length');
  }

  let body = '';
  for (let i = 0; i < bodyLength; i += 1) {
    body += randomDigit().toString();
  }

  const partial = `${binPrefix}${body}`;
  const checkDigit = calculateLuhnCheckDigit(partial);
  return `${partial}${checkDigit}`;
}

export function generateCvc(
  randomDigit: () => number = () => Math.floor(Math.random() * 10)
): string {
  return `${randomDigit()}${randomDigit()}${randomDigit()}`;
}

export function isLuhnValid(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const digits = value.split('').map(Number);
  const checksum = digits.reduceRight((sum, digit, index, arr) => {
    if ((arr.length - index) % 2 === 0) {
      const doubled = digit * 2;
      return sum + (doubled > 9 ? doubled - 9 : doubled);
    }
    return sum + digit;
  }, 0);
  return checksum % 10 === 0;
}

function calculateLuhnCheckDigit(partial: string): number {
  const digits = partial.split('').map(Number);
  const checksum = digits.reduceRight((sum, digit, index, arr) => {
    const positionFromRight = arr.length - index;
    if (positionFromRight % 2 === 1) {
      const doubled = digit * 2;
      return sum + (doubled > 9 ? doubled - 9 : doubled);
    }
    return sum + digit;
  }, 0);
  return (10 - (checksum % 10)) % 10;
}
