const DEFAULT_MYOS_BASE_URL = 'https://api.myos.blue';

const rawBaseUrl = process.env.MYOS_BASE_URL?.trim();
const normalizedBaseUrl =
  rawBaseUrl && rawBaseUrl.length > 0
    ? rawBaseUrl.replace(/\/+$/, '')
    : DEFAULT_MYOS_BASE_URL;

export const MYOS_BASE_URL = normalizedBaseUrl;
export const MYOS_BOOTSTRAP_URL = `${normalizedBaseUrl}/documents/bootstrap`;
export const MYOS_EVENTS_URL = `${normalizedBaseUrl}/myos-events`;

export const MIN_PAYNOTE_VERIFICATION_SCORE = 5;
export const TEST_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
