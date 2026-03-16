import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type AgentEnv = {
  baseUrl: string;
  apiKey: string;
  accountId: string;
};

type BankAgentEnv = {
  baseUrl: string;
  apiKey: string;
  accountId: string;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseEnvFile = (raw: string) => {
  const out: Record<string, string> = {};

  raw.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1));
    if (!key) {
      return;
    }

    out[key] = value;
  });

  return out;
};

const fileDir = dirname(fileURLToPath(import.meta.url));

const resolveAgentEnvCandidates = () => [
  resolve(process.cwd(), '.env.agent'),
  resolve(process.cwd(), '../../.env.agent'),
  resolve(fileDir, '../../../../../.env.agent'),
];

const pick = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

export const loadRepositoryAgentEnv = (override = false) => {
  const filePath = resolveAgentEnvCandidates().find(candidate =>
    existsSync(candidate)
  );

  if (!filePath) {
    return null;
  }

  const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
  Object.entries(parsed).forEach(([key, value]) => {
    if (override || !process.env[key]) {
      process.env[key] = value;
    }
  });

  normalizeAgentEnvAliases();
  return filePath;
};

export const normalizeAgentEnvAliases = () => {
  const baseUrl = pick('MYOS_BASE_URL', 'MYOS_E2E_BASE_URL');
  const apiKey = pick('MYOS_API_KEY', 'MYOS_E2E_API_KEY');
  const accountId = pick('MYOS_ACCOUNT_ID', 'MYOS_E2E_ACCOUNT_ID');

  if (baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    process.env.MYOS_BASE_URL ??= normalized;
    process.env.MYOS_E2E_BASE_URL ??= normalized;
  }
  if (apiKey) {
    process.env.MYOS_API_KEY ??= apiKey;
    process.env.MYOS_E2E_API_KEY ??= apiKey;
  }
  if (accountId) {
    process.env.MYOS_ACCOUNT_ID ??= accountId;
    process.env.MYOS_E2E_ACCOUNT_ID ??= accountId;
  }
};

export const getAgentMyOsEnv = (): Partial<AgentEnv> => {
  normalizeAgentEnvAliases();

  const baseUrl = pick('MYOS_BASE_URL', 'MYOS_E2E_BASE_URL');
  const apiKey = pick('MYOS_API_KEY', 'MYOS_E2E_API_KEY');
  const accountId = pick('MYOS_ACCOUNT_ID', 'MYOS_E2E_ACCOUNT_ID');

  return {
    ...(baseUrl ? { baseUrl: normalizeBaseUrl(baseUrl) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(accountId ? { accountId } : {}),
  };
};

export const requireAgentMyOsEnv = (): AgentEnv => {
  const env = getAgentMyOsEnv();
  if (!env.baseUrl || !env.apiKey || !env.accountId) {
    throw new Error(
      'Missing MyOS agent env. Expected MYOS_BASE_URL, MYOS_API_KEY, and MYOS_ACCOUNT_ID in the repository root .env.agent file or compatible MYOS_E2E_* aliases.'
    );
  }

  return {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    accountId: env.accountId,
  };
};

export const getBankMyOsEnv = (): Partial<BankAgentEnv> => {
  const sharedBaseUrl = pick('MYOS_BASE_URL', 'MYOS_E2E_BASE_URL');
  const apiKey = pick('BANK_MYOS_API_KEY');
  const accountId = pick('BANK_MYOS_ACCOUNT_ID');

  return {
    ...(sharedBaseUrl ? { baseUrl: normalizeBaseUrl(sharedBaseUrl) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(accountId ? { accountId } : {}),
  };
};

export const requireBankMyOsEnv = (): BankAgentEnv => {
  const env = getBankMyOsEnv();
  if (!env.baseUrl || !env.apiKey || !env.accountId) {
    throw new Error(
      'Missing bank MyOS env. Expected MYOS_BASE_URL, BANK_MYOS_API_KEY, and BANK_MYOS_ACCOUNT_ID in the repository root .env.agent file.'
    );
  }

  return {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    accountId: env.accountId,
  };
};
