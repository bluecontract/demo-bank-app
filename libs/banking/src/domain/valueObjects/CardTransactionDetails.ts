export interface CardTransactionDetails {
  retrievalReferenceNumber: string;
  systemTraceAuditNumber: string;
  transmissionDateTime: string;
  authorizationCode: string;
}

const randomDigit = () => Math.floor(Math.random() * 10);

const padLeft = (value: number, length: number) =>
  value.toString().padStart(length, '0');

const buildNumericString = (
  length: number,
  nextDigit: () => number = randomDigit
) => Array.from({ length }, () => nextDigit().toString()).join('');

const buildAlphaNumeric = (
  length: number,
  nextDigit: () => number = randomDigit
) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => {
    const index = nextDigit() % alphabet.length;
    return alphabet[index];
  }).join('');
};

export const generateCardTransactionDetails = (
  clock: () => Date = () => new Date(),
  nextDigit: () => number = randomDigit
): CardTransactionDetails => {
  const now = clock();
  const transmissionDateTime = `${padLeft(now.getUTCMonth() + 1, 2)}${padLeft(
    now.getUTCDate(),
    2
  )}${padLeft(now.getUTCHours(), 2)}${padLeft(now.getUTCMinutes(), 2)}${padLeft(
    now.getUTCSeconds(),
    2
  )}`;

  return {
    retrievalReferenceNumber: buildNumericString(12, nextDigit),
    systemTraceAuditNumber: buildNumericString(6, nextDigit),
    transmissionDateTime,
    authorizationCode: buildAlphaNumeric(6, nextDigit),
  };
};

export const buildCardTransactionDetailsKey = (
  details: CardTransactionDetails
): string =>
  [
    details.retrievalReferenceNumber,
    details.systemTraceAuditNumber,
    details.transmissionDateTime,
    details.authorizationCode,
  ].join('|');
