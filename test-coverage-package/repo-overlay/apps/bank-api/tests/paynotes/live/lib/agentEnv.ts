const pick = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

/**
 * Normalize MyOS env names so tests can consume either:
 * - values sourced from .env.agent (MYOS_BASE_URL / MYOS_API_KEY / MYOS_ACCOUNT_ID)
 * - dedicated E2E aliases (MYOS_E2E_*)
 */
export const getAgentMyOsEnv = () => {
  const baseUrl = pick('MYOS_BASE_URL', 'MYOS_E2E_BASE_URL');
  const apiKey = pick('MYOS_API_KEY', 'MYOS_E2E_API_KEY');
  const accountId = pick('MYOS_ACCOUNT_ID', 'MYOS_E2E_ACCOUNT_ID');

  return { baseUrl, apiKey, accountId };
};

export const requireAgentMyOsEnv = () => {
  const env = getAgentMyOsEnv();
  if (!env.baseUrl || !env.apiKey || !env.accountId) {
    throw new Error(
      'Missing MyOS agent env. Expected MYOS_BASE_URL, MYOS_API_KEY, MYOS_ACCOUNT_ID in .env.agent or equivalent MYOS_E2E_* variables.'
    );
  }
  return {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    accountId: env.accountId,
  };
};
